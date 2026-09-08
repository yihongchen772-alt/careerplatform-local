"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { groupInterviewPrepSchema, type GroupInterviewPrep } from "@/lib/validation";

export async function generateGroupInterviewPrep(
  positionId: string,
  resumeVersionId: string
): Promise<ActionResult<GroupInterviewPrep>> {
  return toActionResult(() => run(positionId, resumeVersionId));
}

async function run(
  positionId: string,
  resumeVersionId: string
): Promise<GroupInterviewPrep> {
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

  const prompt = `你在帮一个中国应届生准备群面（无领导小组讨论），这是校招高频但和一对一面试完全不同的考察方式——考的是候选人在小组讨论里的角色定位、发言时机、协作和领导力表现，不是知识问答。

目标岗位：
${jobDescription}
${!position.jdText ? "\n注意：没有 JD 正文，只能依据岗位名称和方向判断。" : ""}

候选人简历情况：
${resumeText}

请给出：
- overview：一两句话说清楚这个岗位的群面大概会怎么考、跟一对一面试的核心区别是什么
- roleStrategy：结合候选人简历里的经历和性格倾向，建议 TA 在群面里适合争取哪个角色（比如计时员/记录总结者/协调者/普通发言者——不建议每个人都抢"领导者"角色，那是常见误区），并说明理由
- tips：3-5 条具体可执行的技巧，每条包含 title（技巧名称）和 detail（具体怎么做），覆盖发言时机、如何在讨论里露脸但不抢话、遇到冷场或被打断时怎么办
- pitfalls：3-5 条常见的群面减分行为（比如一味反驳别人、全程沉默、抢当"领导"却不听别人说话）
- practiceTopic：给一个真实校招群面风格的练习话题，包含 topic（话题本身，比如排序类/开放讨论类的具体题目）和 instructions（怎么用这个话题自己练习，比如找几个人角色扮演、限时多少分钟）

不要编造简历里没有的经历。全部用中文。`;

  const config = await getUserAiConfig(user.id);
  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    schema: {
      type: "OBJECT",
      properties: {
        overview: { type: "STRING" },
        roleStrategy: { type: "STRING" },
        tips: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              detail: { type: "STRING" },
            },
            required: ["title", "detail"],
          },
        },
        pitfalls: { type: "ARRAY", items: { type: "STRING" } },
        practiceTopic: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING" },
            instructions: { type: "STRING" },
          },
          required: ["topic", "instructions"],
        },
      },
      required: ["overview", "roleStrategy", "tips", "pitfalls", "practiceTopic"],
    },
  });

  const parsed = groupInterviewPrepSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.groupInterviewPrep.upsert({
    where: { positionId },
    create: { userId: user.id, positionId, content: parsed.data },
    update: { content: parsed.data },
  });

  revalidatePath("/pool");
  return parsed.data;
}
