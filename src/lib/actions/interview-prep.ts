"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { interviewPrepSchema, type InterviewPrep } from "@/lib/validation";

export async function generateInterviewPrep(
  positionId: string,
  resumeVersionId: string
): Promise<ActionResult<InterviewPrep>> {
  return toActionResult(() => run(positionId, resumeVersionId));
}

async function run(
  positionId: string,
  resumeVersionId: string
): Promise<InterviewPrep> {
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

  const prompt = `你在帮一个中国应届生准备面试。他还没投递，正在决定要不要投、以及投之前该做什么准备。

目标岗位：
${jobDescription}
${!position.jdText ? "\n注意：没有 JD 正文，只能依据岗位名称和方向判断，建议更笼统一些。" : ""}

候选人简历情况：
${resumeText}

请给出：
- focusAreas：3-5 个需要重点准备的方向，每个包含 title（方向名称）、why（为什么这个方向重要，结合 JD 和简历的差距说）、whatToPrepare（具体准备什么，要可执行，比如"复习 XX 算法""整理一个 XX 项目的量化数据"）
- likelyQuestionTypes：这个岗位大概率会问的问题类型（不是具体题目，是类型，比如"系统设计""项目深挖""行为面 STAR"）
- summary：一两句话的整体建议

不要编造简历里没有的经历。全部用中文。`;

  const config = await getUserAiConfig(user.id);
  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        focusAreas: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              why: { type: "STRING" },
              whatToPrepare: { type: "STRING" },
            },
            required: ["title", "why", "whatToPrepare"],
          },
        },
        likelyQuestionTypes: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["summary", "focusAreas", "likelyQuestionTypes"],
    },
  });

  const parsed = interviewPrepSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.interviewPrep.upsert({
    where: { positionId },
    create: { userId: user.id, positionId, content: parsed.data },
    update: { content: parsed.data },
  });

  revalidatePath("/pool");
  return parsed.data;
}
