"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { questionBankItemSchema, type QuestionBankItem } from "@/lib/question-bank-shared";

const itemsSchema = z.array(questionBankItemSchema);
function readItems(raw: unknown): QuestionBankItem[] {
  const parsed = itemsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

const MIN_QUESTIONS = 3;
const MAX_EXAM_QUESTIONS = 30;

/** Fisher-Yates — Array.sort(() => Math.random() - 0.5) biases toward the
 * original order and gets worse the more elements there are. */
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type ExamQuestion = {
  question: string;
  module: string | null;
  category: string | null;
  referenceAnswer: string | null;
  tips: string | null;
};

export type ExamSummary = {
  id: string;
  bankName: string;
  modules: string[] | null;
  questionCount: number;
  status: "ACTIVE" | "ENDED";
  overallScore: number | null;
  durationMinutes: number;
  createdAt: string;
};

export type ExamDetail = ExamSummary & {
  questions: ExamQuestion[];
  answers: { answer: string; score: number; feedback: string }[] | null;
  summary: string | null;
};

function toSummary(e: {
  id: string;
  bankName: string;
  modules: unknown;
  questions: unknown;
  status: string;
  overallScore: number | null;
  durationMinutes: number;
  createdAt: Date;
}): ExamSummary {
  return {
    id: e.id,
    bankName: e.bankName,
    modules: Array.isArray(e.modules) ? (e.modules as string[]) : null,
    questionCount: readItems(e.questions).length,
    status: e.status as "ACTIVE" | "ENDED",
    overallScore: e.overallScore,
    durationMinutes: e.durationMinutes,
    createdAt: e.createdAt.toISOString(),
  };
}

export async function listExamSessions(userId: string): Promise<ExamSummary[]> {
  const sessions = await db.examSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return sessions.map(toSummary);
}

export async function getExamSession(id: string): Promise<ActionResult<ExamDetail>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const session = await db.examSession.findFirst({ where: { id, userId: user.id } });
    if (!session) throw new UserFacingError("找不到这场考试");

    const questions = readItems(session.questions).map((q) => ({
      question: q.question,
      module: q.module ?? null,
      category: q.category ?? null,
      referenceAnswer: q.referenceAnswer ?? null,
      tips: q.tips ?? null,
    }));
    const answersSchema = z.array(
      z.object({ answer: z.string(), score: z.number(), feedback: z.string() })
    );
    const parsedAnswers = answersSchema.safeParse(session.answers);

    return {
      ...toSummary(session),
      questions,
      answers: parsedAnswers.success ? parsedAnswers.data : null,
      summary: session.summary,
    };
  });
}

/**
 * Starts a timed practice run drawn from one bank, optionally filtered to a
 * subset of modules. Questions are snapshotted into the session rather than
 * referenced live — editing the bank later (re-classifying modules, filling
 * in answers) must not retroactively rewrite a past exam's content or score.
 */
export async function startExam(input: {
  bankId: string;
  modules: string[] | null;
  count: number;
  durationMinutes: number;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const bank = await db.questionBank.findFirst({
      where: { id: input.bankId, userId: user.id },
    });
    if (!bank) throw new UserFacingError("找不到这个题库");

    const all = readItems(bank.questions);
    const pool = input.modules?.length
      ? all.filter((q) => q.module && input.modules!.includes(q.module))
      : all;
    if (pool.length < MIN_QUESTIONS) {
      throw new UserFacingError(
        `选中的范围里只有 ${pool.length} 道题，至少要 ${MIN_QUESTIONS} 道才能组成一场考试`
      );
    }

    const count = Math.min(Math.max(input.count, MIN_QUESTIONS), MAX_EXAM_QUESTIONS, pool.length);
    const questions = shuffle(pool).slice(0, count);

    const session = await db.examSession.create({
      data: {
        userId: user.id,
        bankId: bank.id,
        bankName: bank.name,
        modules: input.modules?.length ? input.modules : undefined,
        questions,
        durationMinutes: Math.max(5, input.durationMinutes),
        status: "ACTIVE",
      },
    });

    revalidatePath("/question-banks");
    return { id: session.id };
  });
}

const gradedItemSchema = z.object({
  score: z.number(),
  feedback: z.string(),
});

/**
 * Grades the whole exam in one pass after the user submits (or the timer
 * runs out). Batch grading rather than per-question feedback while
 * answering — a real exam isn't checked question-by-question as you go,
 * that would defeat the point of simulating one.
 */
export async function submitExam(
  examSessionId: string,
  answers: { index: number; answer: string }[]
): Promise<ActionResult<{ overallScore: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const session = await db.examSession.findFirst({
      where: { id: examSessionId, userId: user.id },
    });
    if (!session) throw new UserFacingError("找不到这场考试");
    if (session.status === "ENDED") throw new UserFacingError("这场考试已经交过卷了");

    const questions = readItems(session.questions);
    const answerByIndex = new Map(answers.map((a) => [a.index, a.answer]));
    const filledAnswers = questions.map((_, i) => answerByIndex.get(i)?.trim() ?? "");

    const config = await getUserAiConfig(user.id);
    if (!config) throw new UserFacingError("先去账号设置配置一个 AI Key 才能用这个功能");

    // Bounded per call, same reasoning as fillBankAnswers: a 30-question
    // exam in one request risks the output getting cut off mid-JSON.
    const BATCH = 6;
    const graded: { answer: string; score: number; feedback: string }[] = new Array(
      questions.length
    );

    for (let start = 0; start < questions.length; start += BATCH) {
      const batchIdx = Array.from(
        { length: Math.min(BATCH, questions.length - start) },
        (_, k) => start + k
      );
      const prompt = `你在给一场技术模拟考试打分。下面是几道题、参考答案（可能为空）、和候选人的实际作答。逐题打分。

${batchIdx
  .map((i) => {
    const q = questions[i];
    const ans = filledAnswers[i];
    return `题目 ${i + 1}${q.module ? `（模块：${q.module}）` : ""}：${q.question}
参考答案：${q.referenceAnswer || "（无参考答案，凭题目本身和常识判断candidate回答是否正确、完整）"}
候选人作答：${ans || "（空白，没有作答）"}`;
  })
  .join("\n\n")}

对每题给出：
- score：0-100 的分数。空白作答直接打 0；作答内容跟题目/参考答案完全不沾边也应该给低分；不要因为"态度认真"或"写了很多字"而放宽，只看内容是否正确、完整
- feedback：一两句具体反馈——答对了哪部分、漏了什么、哪里理解错了。不要只说"回答得不错"这种空话

按题目顺序返回，数量必须和上面的题目数量一致。全部用中文。`;

      const raw = await callTextAi({
        config,
        prompt,
        thinkingBudget: 1024,
        timeoutMs: 90000,
        schema: {
          type: "OBJECT",
          properties: {
            grades: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  score: { type: "NUMBER" },
                  feedback: { type: "STRING" },
                },
                required: ["score", "feedback"],
              },
            },
          },
          required: ["grades"],
        },
      });

      const parsed = z.object({ grades: z.array(gradedItemSchema) }).safeParse(raw);
      batchIdx.forEach((qi, n) => {
        const g = parsed.success ? parsed.data.grades[n] : undefined;
        graded[qi] = {
          answer: filledAnswers[qi],
          score: g ? Math.max(0, Math.min(100, Math.round(g.score))) : 0,
          feedback: g?.feedback ?? "AI 没能给出这道题的反馈，可能是批量打分时出了点问题。",
        };
      });
    }

    const overallScore = Math.round(
      graded.reduce((sum, g) => sum + g.score, 0) / Math.max(1, graded.length)
    );

    // One more call for a short overall summary — cheap relative to the
    // per-question grading above, and "62 分，强化学习部分明显薄弱" is a
    // lot more useful than just staring at a bare number.
    const moduleBreakdown = new Map<string, number[]>();
    questions.forEach((q, i) => {
      const key = q.module || "未分类";
      if (!moduleBreakdown.has(key)) moduleBreakdown.set(key, []);
      moduleBreakdown.get(key)!.push(graded[i].score);
    });
    const breakdownText = Array.from(moduleBreakdown.entries())
      .map(([m, scores]) => `${m}：平均 ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)} 分`)
      .join("；");

    const summaryRaw = await callTextAi({
      config,
      prompt: `一场模拟考试刚交卷，总分 ${overallScore}/100。各模块平均分：${breakdownText}。请给一两句总体评价，指出明显薄弱的模块、建议接下来重点复习什么。中文，简短。`,
      thinkingBudget: 256,
      timeoutMs: 30000,
      schema: {
        type: "OBJECT",
        properties: { summary: { type: "STRING" } },
        required: ["summary"],
      },
    }).catch(() => null);
    const summaryParsed = z.object({ summary: z.string() }).safeParse(summaryRaw);

    await db.examSession.update({
      where: { id: session.id },
      data: {
        answers: graded,
        overallScore,
        summary: summaryParsed.success ? summaryParsed.data.summary : null,
        status: "ENDED",
      },
    });

    revalidatePath("/question-banks");
    revalidatePath(`/question-banks/exam/${session.id}`);
    return { overallScore };
  });
}

export async function deleteExamSession(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.examSession.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/question-banks");
    return null;
  });
}
