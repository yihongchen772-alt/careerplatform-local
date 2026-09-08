"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const letterSchema = z.object({ letter: z.string() });

/** Same "one per position, regenerating overwrites" shape as
 * generateInterviewPrep — works with whatever AI provider the user has
 * configured (getResumeContext no longer needs a file-capable one, see
 * src/lib/resume-context.ts). */
export async function generateCoverLetter(
  positionId: string,
  resumeVersionId: string
): Promise<ActionResult<string>> {
  return toActionResult(() => run(positionId, resumeVersionId));
}

async function run(positionId: string, resumeVersionId: string): Promise<string> {
  const user = await requireUser();

  const position = await db.position.findFirst({
    where: { id: positionId, userId: user.id },
    include: { company: true },
  });
  if (!position) throw new UserFacingError("未找到该岗位");

  const { resumeText } = await getResumeContext(resumeVersionId, user.id);

  const jobDescription = [
    `公司：${position.company.name}`,
    `岗位：${position.title}`,
    position.track ? `方向：${position.track}` : null,
    position.jdText ? `\nJD 正文：\n${position.jdText.slice(0, 6000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `你在帮一个中国应届生写投递这个岗位用的自荐信/求职信。

目标岗位：
${jobDescription}
${!position.jdText ? "\n注意：没有 JD 正文，只能依据岗位名称和方向判断，内容要更笼统一些，不要编造具体的职责要求。" : ""}

候选人简历情况：
${resumeText}

要求：
- 只用简历里确实有的经历、项目、技能，不要编造简历里没有的内容
- 结合 JD 说清楚"为什么适合这个岗位"，不是泛泛地夸自己，要具体到简历里的哪段经历对应 JD 的哪个要求
- 篇幅 300-500 字，语气真诚、专业，不要浮夸的形容词堆砌，不要写"我是一个xxx的人"这类空话
- 格式：开头称呼（"尊敬的招聘负责人："或类似），中间正文，结尾一句话表达期待面试的意愿，不需要落款签名
- 全部用中文

返回 letter 字段，值是完整的自荐信正文（含称呼和结尾），可以直接复制使用。`;

  const config = await getUserAiConfig(user.id);
  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    schema: {
      type: "OBJECT",
      properties: { letter: { type: "STRING" } },
      required: ["letter"],
    },
  });

  const parsed = letterSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.coverLetter.upsert({
    where: { positionId },
    create: { userId: user.id, positionId, content: parsed.data.letter },
    update: { content: parsed.data.letter },
  });

  revalidatePath("/pool");
  return parsed.data.letter;
}
