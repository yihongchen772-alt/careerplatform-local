"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import {
  drillTreeSchema,
  parseAnswers,
  type DrillAnswer,
  type DrillTree,
  type ResumeDrillDTO,
} from "@/lib/resume-drill";

// 简历深挖模拟 — the interviewer's follow-up tree over the candidate's own
// resume. Generation is one AI call that reads the whole resume and lays
// out every project's probes up front; each answer is a second, smaller
// call graded against that question's own keyPoints. Kept separate from
// the free-chat 模拟面试 on purpose: the value here is seeing the whole
// tree (which project has an L3 you haven't survived yet), not the chat.

// A free-chat interview gets away with the shared quota; this makes one
// large call per generation and one per answer, so it's own-key only, same
// rule as 模拟面试.
async function requireOwnAiConfig(userId: string) {
  const config = await getUserAiConfig(userId);
  if (!config) {
    throw new UserFacingError("先在「账号设置」里配置你自己的 AI API Key 才能用简历深挖");
  }
  return config;
}

function parseTree(raw: unknown): DrillTree {
  const parsed = drillTreeSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");
  // Ids come from the model; make them globally unique and stable-looking
  // regardless of what it chose, since answers key on them.
  const projects = parsed.data.projects
    .filter((p) => p.questions.length > 0)
    .map((p, pi) => ({
      ...p,
      id: `p${pi + 1}`,
      questions: p.questions
        .slice()
        .sort((a, b) => a.level - b.level)
        .map((q, qi) => ({ ...q, id: `p${pi + 1}q${qi + 1}` })),
    }));
  if (projects.length === 0) throw new UserFacingError("AI 没能从简历里找到可以追问的经历，检查一下简历内容是否已提取");
  return { projects };
}

async function describePosition(userId: string, positionId: string | null | undefined) {
  if (!positionId) return { label: null as string | null, context: "" };
  const position = await db.position.findFirst({
    where: { id: positionId, userId },
    include: { company: true },
  });
  if (!position) throw new UserFacingError("未找到该候选岗位");
  const context = [
    `公司：${position.company.name}`,
    `岗位：${position.title}`,
    position.track ? `方向：${position.track}` : null,
    position.jdText ? `JD 正文：\n${position.jdText.slice(0, 3000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { label: `${position.company.name} · ${position.title}`, context };
}

export async function generateResumeDrill(input: {
  resumeVersionId: string;
  positionId?: string | null;
}): Promise<ActionResult<ResumeDrillDTO>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const config = await requireOwnAiConfig(user.id);
    const { resumeText } = await getResumeContext(input.resumeVersionId, user.id);
    const target = await describePosition(user.id, input.positionId);

    const prompt = `你是一位经验丰富的面试官，正在为一名中国应届生的面试做准备。面试官最常用的套路是"盯着简历上的项目/实习往深了问"——先让候选人讲全貌，再抠细节和为什么，最后压力追问。请你读下面这份简历，把这套追问提前列出来，让候选人练习。

${target.context ? `目标岗位（追问要往这个岗位关心的能力上靠）：\n${target.context}\n\n` : ""}候选人简历：
${resumeText}

要求：
1. 从简历里挑出 3 到 5 段最可能被面试官深挖的经历（项目、实习、科研、竞赛都算），按"最容易被问"排序。每段给 name（简短名称，照简历原文）和 summary（一句话概括简历上写了什么，用于让候选人对上号）。
2. 每段经历生成 4 到 5 个追问，分三层，level 字段标 1/2/3：
   - level 1（1 题）：让候选人讲清全貌和"你自己具体负责什么"——面试官用它区分是真做了还是挂名。
   - level 2（2 题）：抠细节。技术选型为什么这样选而不是别的、某个数字/效果是怎么衡量出来的、遇到的最大困难怎么解决——要具体到简历上写的那个点，不要问泛泛的"你学到了什么"。
   - level 3（1-2 题）：压力追问。如果重来会怎么做、这个方案的局限/失败情况、简历上的数据是否经得起推敲、换个条件还成立吗。
3. 每题给 intent（面试官问这道题到底想验证什么，一句话）和 keyPoints（一个好回答应该覆盖的 2-4 个要点，具体、可核对）。
4. 全部用中文，问题要像真人面试官口头会问的那样自然，不要编号前缀。id 字段随便填一个短字符串即可。`;

    const raw = await callTextAi({
      config,
      prompt,
      thinkingBudget: 2048,
      timeoutMs: 120000,
      schema: {
        type: "OBJECT",
        properties: {
          projects: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                name: { type: "STRING" },
                summary: { type: "STRING" },
                questions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      id: { type: "STRING" },
                      level: { type: "NUMBER" },
                      question: { type: "STRING" },
                      intent: { type: "STRING" },
                      keyPoints: { type: "ARRAY", items: { type: "STRING" } },
                    },
                    required: ["id", "level", "question", "intent", "keyPoints"],
                  },
                },
              },
              required: ["id", "name", "summary", "questions"],
            },
          },
        },
        required: ["projects"],
      },
    });
    const tree = parseTree(raw);

    // Regeneration wipes answers: the ids above are re-derived from position
    // in the new tree, so an old answer would land on a different question.
    const drill = await db.resumeDrill.upsert({
      where: { resumeVersionId: input.resumeVersionId },
      create: {
        userId: user.id,
        resumeVersionId: input.resumeVersionId,
        positionId: input.positionId || null,
        tree: tree as Prisma.InputJsonValue,
        answers: {},
      },
      update: {
        positionId: input.positionId || null,
        tree: tree as Prisma.InputJsonValue,
        answers: {},
      },
    });

    revalidatePath("/resume-drill");
    return {
      id: drill.id,
      resumeVersionId: drill.resumeVersionId,
      positionId: drill.positionId,
      positionLabel: target.label,
      tree,
      answers: {},
      updatedAt: drill.updatedAt.toISOString(),
    };
  });
}

export async function answerDrillQuestion(input: {
  drillId: string;
  questionId: string;
  answer: string;
}): Promise<ActionResult<DrillAnswer>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const answerText = input.answer.trim();
    if (answerText.length < 10) throw new UserFacingError("回答太短了，面试官会觉得你在敷衍——至少说几句");

    const drill = await db.resumeDrill.findFirst({
      where: { id: input.drillId, userId: user.id },
    });
    if (!drill) throw new UserFacingError("未找到这份深挖记录，先重新生成");
    const tree = drillTreeSchema.parse(drill.tree);
    const project = tree.projects.find((p) => p.questions.some((q) => q.id === input.questionId));
    const question = project?.questions.find((q) => q.id === input.questionId);
    if (!project || !question) throw new UserFacingError("这道题已经不在当前追问树里了，刷新一下");

    const config = await requireOwnAiConfig(user.id);
    const target = await describePosition(user.id, drill.positionId);

    const prompt = `你是一位严格但公正的面试官，正在评价候选人对一道简历追问的回答。

${target.context ? `目标岗位：\n${target.context}\n\n` : ""}这段经历（简历上写的）：${project.name}——${project.summary}

你问的问题（第 ${question.level} 层追问）：${question.question}
你问这题想验证的是：${question.intent}
一个好回答应该覆盖的要点：
${question.keyPoints.map((k, i) => `${i + 1}. ${k}`).join("\n")}

候选人的回答：
${answerText}

请给出：
- score：0-10 分。要点全覆盖且有具体细节给 8-10；覆盖一半、说得笼统给 4-6；答非所问、只有套话、或明显在回避给 0-3。
- feedback：具体指出哪些要点覆盖了、哪些没有，引用候选人回答里的原话说明问题；不要写"总体不错"这种空话。两到四句。
- betterAnswer：一个更好的回答该怎么组织——给一个 3-5 句的回答框架（用第一人称，像候选人自己在说），要用上候选人回答里已有的真实信息，缺的地方用【这里补充：……】标出来让他自己填，不要替他编造数据。
- followUp：听完这个回答后，真实面试官接下来最可能追问的一句话——要针对这个回答里最薄弱、最含糊的那个点。

全部用中文。`;

    const raw = await callTextAi({
      config,
      prompt,
      thinkingBudget: 1024,
      timeoutMs: 60000,
      schema: {
        type: "OBJECT",
        properties: {
          score: { type: "NUMBER" },
          feedback: { type: "STRING" },
          betterAnswer: { type: "STRING" },
          followUp: { type: "STRING" },
        },
        required: ["score", "feedback", "betterAnswer", "followUp"],
      },
    });
    const graded = z
      .object({
        score: z.number().min(0).max(10),
        feedback: z.string(),
        betterAnswer: z.string(),
        followUp: z.string(),
      })
      .safeParse(raw);
    if (!graded.success) throw new UserFacingError("AI 返回格式异常，请重试");

    const record: DrillAnswer = {
      answer: answerText,
      ...graded.data,
      score: Math.round(graded.data.score * 10) / 10,
      answeredAt: new Date().toISOString(),
    };
    const answers = { ...parseAnswers(drill.answers), [question.id]: record };
    await db.resumeDrill.update({
      where: { id: drill.id },
      data: { answers: answers as Prisma.InputJsonValue },
    });

    revalidatePath("/resume-drill");
    return record;
  });
}

/**
 * Turns the drill tree into a 题库 — the questions are the interviewer's
 * probes for THIS resume, and the answered ones carry the user's own graded
 * answer as the reference, which beats any generic 面经 for rehearsal.
 */
export async function saveDrillAsBank(drillId: string): Promise<ActionResult<{ id: string; count: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const drill = await db.resumeDrill.findFirst({
      where: { id: drillId, userId: user.id },
      include: { resumeVersion: true, position: { include: { company: true } } },
    });
    if (!drill) throw new UserFacingError("未找到这份深挖记录");
    const tree = drillTreeSchema.parse(drill.tree);
    const answers = parseAnswers(drill.answers);
    const questions = tree.projects.flatMap((p) =>
      p.questions.map((q) => {
        const a = answers[q.id];
        return {
          question: q.question,
          category: `项目深挖 · ${p.name}`,
          module: null,
          referenceAnswer: a ? `${a.score}/10 分的回答：${a.answer}\n\n更好的说法：${a.betterAnswer}` : null,
          tips: `面试官想验证：${q.intent}。要点：${q.keyPoints.join("；")}`,
        };
      })
    );
    const bank = await db.questionBank.create({
      data: {
        userId: user.id,
        name: `简历深挖 · ${drill.resumeVersion.name}${drill.position ? ` · ${drill.position.company.name}` : ""}`,
        source: "简历深挖",
        questions,
      },
    });
    revalidatePath("/question-banks");
    return { id: bank.id, count: questions.length };
  });
}
