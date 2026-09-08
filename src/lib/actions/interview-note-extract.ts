"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const extractSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      category: z.string(),
    })
  ),
});

export type ExtractedQuestion = z.infer<typeof extractSchema>["questions"][number];

/**
 * 面经库 notes are free-text a user typed after an interview ("问了我讲讲
 * Redis 持久化，还问了一道场景题关于分布式锁，最后反问了下加班情况") —
 * this pulls the actual questions out into a tagged, scannable list instead
 * of leaving every future re-read to parse the paragraph by eye. On demand
 * (one button per note), not automatic — same reasoning as InterviewPrep/
 * CoverLetter: an AI call is a paid call, and the note isn't going anywhere.
 */
export async function extractInterviewQuestions(
  stageHistoryId: string
): Promise<ActionResult<ExtractedQuestion[]>> {
  return toActionResult(() => run(stageHistoryId));
}

async function run(stageHistoryId: string): Promise<ExtractedQuestion[]> {
  const user = await requireUser();

  const history = await db.stageHistory.findFirst({
    where: { id: stageHistoryId, application: { userId: user.id } },
    include: { application: { include: { company: true } } },
  });
  if (!history) throw new UserFacingError("未找到这条面试记录");
  if (!history.note?.trim()) throw new UserFacingError("这条记录没有笔记内容可以提取");

  const config = await getUserAiConfig(user.id);
  const prompt = `下面是应届生 ${history.application.company.name} · ${history.application.title} 一场面试后写的复盘笔记，帮我把实际被问到的问题提取出来整理成清单。

笔记原文：
${history.note}

要求：
- 只提取笔记里明确写到"问了/问到/问道"这类的具体问题，笔记里的感想、结果（比如"感觉答得不好""气氛很好""过了"）不算问题，不要提取
- category：给每个问题归一个类别，比如"自我介绍"、"项目深挖"、"技术基础"、"系统设计"、"场景题"、"行为面/STAR"、"反问环节"，没有合适的就写"其他"
- 笔记里如果压根没提到任何具体问题，返回空数组，不要为了凑数编一个
- 不要编造笔记里没写的内容，只做提取和归类。全部用中文`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 512,
    schema: {
      type: "OBJECT",
      properties: {
        questions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              question: { type: "STRING" },
              category: { type: "STRING" },
            },
            required: ["question", "category"],
          },
        },
      },
      required: ["questions"],
    },
  });

  const parsed = extractSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.interviewNoteExtract.upsert({
    where: { stageHistoryId },
    create: { userId: user.id, stageHistoryId, questions: parsed.data.questions },
    update: { questions: parsed.data.questions },
  });

  revalidatePath("/interviews");
  return parsed.data.questions;
}
