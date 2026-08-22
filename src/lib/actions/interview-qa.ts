"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { interviewQaSchema, type InterviewQa } from "@/lib/validation";

export async function generateInterviewQa(
  applicationId: string,
  resumeVersionId: string
): Promise<ActionResult<InterviewQa>> {
  return toActionResult(() => run(applicationId, resumeVersionId));
}

async function run(
  applicationId: string,
  resumeVersionId: string
): Promise<InterviewQa> {
  const user = await requireUser();

  const application = await db.application.findFirst({
    where: { id: applicationId, userId: user.id },
    include: { company: true, position: true },
  });
  if (!application) throw new UserFacingError("未找到该投递记录");

  const { resumeText } = await getResumeContext(resumeVersionId, user.id);

  const jobDescription = [
    `公司：${application.company.name}`,
    `岗位：${application.title}`,
    application.position?.track ? `方向：${application.position.track}` : null,
    application.position?.jdText
      ? `\nJD 正文：\n${application.position.jdText.slice(0, 6000)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `你是这个岗位的技术/HR 面试官，正在帮候选人做模拟面试准备。他已经投递了这个岗位，需要一套具体的题目和参考答案来练习。

目标岗位：
${jobDescription}
${!application.position?.jdText ? "\n注意：没有 JD 正文，只能依据岗位名称判断，题目会更通用一些。" : ""}

候选人简历情况：
${resumeText}

请生成 6-8 道这个岗位大概率会问的面试题，覆盖技术/专业能力、项目经历追问、行为面（STAR）等不同类型，每道题包含：
- question：具体题目
- category：题目类型（如"技术基础""项目深挖""行为面"）
- referenceAnswer：参考答题思路，要结合候选人简历里**真实存在**的经历给建议，不要编造简历里没有的内容；如果简历里没有相关经历，就给通用的答题框架
- tips：这道题的答题技巧或常见误区

再给一句 summary 总体建议。全部用中文。`;

  const config = await getUserAiConfig(user.id);
  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1536,
    timeoutMs: 90000,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        questions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              question: { type: "STRING" },
              category: { type: "STRING" },
              referenceAnswer: { type: "STRING" },
              tips: { type: "STRING" },
            },
            required: ["question", "category", "referenceAnswer", "tips"],
          },
        },
      },
      required: ["summary", "questions"],
    },
  });

  const parsed = interviewQaSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.interviewQA.upsert({
    where: { applicationId },
    create: { userId: user.id, applicationId, content: parsed.data },
    update: { content: parsed.data },
  });

  revalidatePath(`/applications/${applicationId}`);
  return parsed.data;
}
