"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const postmortemSchema = z.object({
  reflectionQuestions: z.array(z.string()),
  improvements: z.array(z.string()),
});

export type StagePostmortem = z.infer<typeof postmortemSchema>;

/**
 * A per-interview reflection, not a per-week one — WeeklyReview aggregates
 * across a whole week, by which point the specifics of any one interview
 * have already faded into a vague summary. This reads the note right after
 * the interview, while detail is still fresh, and asks 2-3 pointed
 * reflection questions plus concrete "do differently next time" advice. On
 * demand (one button per stage), same reasoning as InterviewNoteExtract.
 */
export async function generateStagePostmortem(
  stageHistoryId: string
): Promise<ActionResult<StagePostmortem>> {
  return toActionResult(() => run(stageHistoryId));
}

async function run(stageHistoryId: string): Promise<StagePostmortem> {
  const user = await requireUser();

  const history = await db.stageHistory.findFirst({
    where: { id: stageHistoryId, application: { userId: user.id } },
    include: { application: { include: { company: true } } },
  });
  if (!history) throw new UserFacingError("未找到这条面试记录");
  if (!history.note?.trim()) throw new UserFacingError("这条记录没有笔记内容可以复盘");

  const config = await getUserAiConfig(user.id);
  const prompt = `下面是应届生 ${history.application.company.name} · ${history.application.title} 一场面试后写的复盘笔记，帮 TA 做一次针对这场面试的复盘——不是泛泛的鼓励，要具体、可执行。

笔记原文：
${history.note}

要求：
- reflectionQuestions：给 2-3 个针对性的反思问题，帮 TA 想清楚这场面试里具体哪块答得不够好、为什么——问题要基于笔记里实际写到的内容，不要问笔记里完全没提到的东西
- improvements：给 2-4 条具体的"下次可以怎么改"建议，要可执行（比如"XX 知识点回去过一遍""下次被问到项目要先说结论再展开"），不要写"多准备""更自信"这种空话
- 如果笔记里的内容太笼统、看不出具体问题在哪，可以在 improvements 里建议下次记笔记时多写点具体的问答内容
- 全部用中文，不要编造笔记里没有的内容`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 512,
    schema: {
      type: "OBJECT",
      properties: {
        reflectionQuestions: { type: "ARRAY", items: { type: "STRING" } },
        improvements: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["reflectionQuestions", "improvements"],
    },
  });

  const parsed = postmortemSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.stagePostmortem.upsert({
    where: { stageHistoryId },
    create: { userId: user.id, stageHistoryId, content: parsed.data },
    update: { content: parsed.data },
  });

  revalidatePath(`/applications/${history.applicationId}`);
  return parsed.data;
}
