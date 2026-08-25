"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { getResumeContext } from "@/lib/resume-context";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import {
  parseBankInput,
  questionBankItemSchema,
  MAX_QUESTIONS,
  type QuestionBankItem,
} from "@/lib/question-bank-shared";
import { z } from "zod";

export type QuestionBankSummary = {
  id: string;
  name: string;
  source: string | null;
  count: number;
  answered: number;
  createdAt: string;
};

const itemsSchema = z.array(questionBankItemSchema);

function readItems(raw: unknown): QuestionBankItem[] {
  const parsed = itemsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export async function listQuestionBanks(userId: string): Promise<QuestionBankSummary[]> {
  const banks = await db.questionBank.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return banks.map((b) => {
    const items = readItems(b.questions);
    return {
      id: b.id,
      name: b.name,
      source: b.source,
      count: items.length,
      answered: items.filter((q) => q.referenceAnswer).length,
      createdAt: b.createdAt.toISOString(),
    };
  });
}

export async function getQuestionBank(
  id: string
): Promise<ActionResult<{ name: string; source: string | null; questions: QuestionBankItem[] }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const bank = await db.questionBank.findFirst({ where: { id, userId: user.id } });
    if (!bank) throw new UserFacingError("找不到这个题库");
    return { name: bank.name, source: bank.source, questions: readItems(bank.questions) };
  });
}

export async function importQuestionBank(input: {
  name: string;
  source?: string;
  raw: string;
}): Promise<ActionResult<{ id: string; count: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (!input.name.trim()) throw new UserFacingError("给这个题库起个名字");

    const parsed = parseBankInput(input.raw);
    if (!parsed) throw new UserFacingError("没从里面读出任何题目，检查一下内容格式");

    const bank = await db.questionBank.create({
      data: {
        userId: user.id,
        // A name inside an exported file is the author's; the one typed here
        // is the user's own label for it, so it wins.
        name: input.name.trim(),
        source: input.source?.trim() || parsed.source || null,
        questions: parsed.questions,
      },
    });

    revalidatePath("/question-banks");
    return { id: bank.id, count: parsed.questions.length };
  });
}

/** Saves an application's generated Q&A as a standalone, exportable bank. */
export async function saveQaAsBank(
  applicationId: string
): Promise<ActionResult<{ id: string; count: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const qa = await db.interviewQA.findFirst({
      where: { applicationId, userId: user.id },
      include: { application: { include: { company: true } } },
    });
    if (!qa) throw new UserFacingError("这条投递还没有生成过面试题库");

    const content = qa.content as { questions?: unknown };
    const questions = readItems(content?.questions);
    if (questions.length === 0) throw new UserFacingError("这个题库是空的");

    const bank = await db.questionBank.create({
      data: {
        userId: user.id,
        name: `${qa.application.company.name} · ${qa.application.title}`,
        source: "AI 生成",
        questions,
      },
    });

    revalidatePath("/question-banks");
    return { id: bank.id, count: questions.length };
  });
}

export async function deleteQuestionBank(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.questionBank.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/question-banks");
    return null;
  });
}

/**
 * Fills in reference answers for questions that don't have one. An imported
 * bank is usually a bare list of questions — useful as a checklist, useless
 * as practice material — and this is what turns it into the latter. Only
 * unanswered questions are sent, so re-running after a partial failure
 * doesn't pay for the same answers twice.
 */
export async function fillBankAnswers(
  id: string
): Promise<ActionResult<{ filled: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const bank = await db.questionBank.findFirst({ where: { id, userId: user.id } });
    if (!bank) throw new UserFacingError("找不到这个题库");

    const questions = readItems(bank.questions);
    const pending = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => !q.referenceAnswer);
    if (pending.length === 0) throw new UserFacingError("这个题库的题目都已经有参考思路了");

    const config = await getUserAiConfig(user.id);
    if (!config) throw new UserFacingError("先去账号设置配置一个 AI Key 才能用这个功能");

    // Resume context sharpens the answers but must not gate the feature:
    // getResumeContext throws unless that resume has already been through an
    // AI 体检, and refusing to fill in answers because of that would be
    // punishing the user for not having run an unrelated feature.
    const defaultResume = await db.resumeVersion.findFirst({
      where: { userId: user.id, NOT: { checkResult: { equals: Prisma.DbNull } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    const resumeText = defaultResume
      ? (await getResumeContext(defaultResume.id, user.id)).resumeText
      : "（用户还没做过简历体检，没有简历内容可参考——请给通用的答题框架，不要假设他有任何具体经历）";

    // Bounded per call: a 200-question bank in one request would blow past
    // any provider's output limit and come back truncated mid-JSON.
    const BATCH = 8;
    let filled = 0;
    for (let start = 0; start < pending.length; start += BATCH) {
      const batch = pending.slice(start, start + BATCH);
      const prompt = `你在帮一名中国应届生准备秋招面试。下面是几道面试题，请逐题给出参考答题思路。

候选人简历情况：
${resumeText}

题目：
${batch.map(({ q }, n) => `${n + 1}. ${q.question}`).join("\n")}

对每道题给出：
- category：题目类型（比如「项目经历」「计算机基础」「行为面试」）
- referenceAnswer：答题思路。要结合简历里**真实存在**的经历给建议，不要编造简历里没有的内容；简历里没有相关经历就给通用的答题框架
- tips：答题技巧或常见误区，一句话

按题目顺序返回，数量必须和上面的题目数量一致。全部用中文。`;

      const raw = await callTextAi({
        config,
        prompt,
        thinkingBudget: 1024,
        timeoutMs: 90000,
        schema: {
          type: "OBJECT",
          properties: {
            answers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  category: { type: "STRING" },
                  referenceAnswer: { type: "STRING" },
                  tips: { type: "STRING" },
                },
                required: ["category", "referenceAnswer", "tips"],
              },
            },
          },
          required: ["answers"],
        },
      });

      const parsed = z
        .object({
          answers: z.array(
            z.object({
              category: z.string().nullish(),
              referenceAnswer: z.string().nullish(),
              tips: z.string().nullish(),
            })
          ),
        })
        .safeParse(raw);
      if (!parsed.success) continue;

      // Zip by position, and only as far as both sides go: a model that
      // returns fewer answers than questions must not shift every remaining
      // answer onto the wrong question.
      parsed.data.answers.slice(0, batch.length).forEach((a, n) => {
        const target = questions[batch[n].i];
        if (!a.referenceAnswer) return;
        target.category = a.category ?? target.category ?? null;
        target.referenceAnswer = a.referenceAnswer;
        target.tips = a.tips ?? null;
        filled += 1;
      });
    }

    if (filled === 0) throw new UserFacingError("AI 没能生成参考思路，请重试");

    await db.questionBank.update({
      where: { id: bank.id },
      data: { questions: questions.slice(0, MAX_QUESTIONS) },
    });
    revalidatePath("/question-banks");
    return { filled };
  });
}
