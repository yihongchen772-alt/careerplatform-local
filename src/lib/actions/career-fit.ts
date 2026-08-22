"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { careerFitAnalysisSchema, type CareerFitAnalysis } from "@/lib/validation";
import { PERSONALITY_TESTS } from "@/lib/personality-tests";
import type { PersonalityTestType } from "@prisma/client";

export async function generateCareerFitAnalysis(): Promise<
  ActionResult<CareerFitAnalysis>
> {
  return toActionResult(run);
}

async function run(): Promise<CareerFitAnalysis> {
  const user = await requireUser();

  const results = await db.personalityTestResult.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  if (results.length === 0) {
    throw new UserFacingError("先完成至少一个测试，再来看综合分析");
  }

  // Most recent result per test type — a retake should supersede the old one.
  const latestByType = new Map<PersonalityTestType, (typeof results)[number]>();
  for (const r of results) {
    if (!latestByType.has(r.testType)) latestByType.set(r.testType, r);
  }

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { targetTrack: true, skills: true },
  });

  const testSummaries = [...latestByType.values()]
    .map((r) => {
      const test = PERSONALITY_TESTS[r.testType];
      const scores = r.scores as Record<string, number>;
      const scoreLines = test.dimensions
        .map((d) => `${d.label}：${scores[d.key] ?? "-"}`)
        .join("，");
      return `${test.title} → 结果：${r.resultLabel}（${scoreLines}）`;
    })
    .join("\n");

  const prefLines = [
    dbUser?.targetTrack ? `已填写的求职方向：${dbUser.targetTrack}` : null,
    dbUser?.skills ? `擅长技能：${dbUser.skills}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `你在帮一个中国应届生做求职方向分析。以下是他做过的性格/职业兴趣自测结果（自制简化版，仅供参考，不是严谨心理测评）。

测试结果：
${testSummaries}

${prefLines || "（他还没有在账号设置里填写求职方向或技能偏好）"}

请基于以上信息做一次常规的求职方向分析，注意：
- 这是自测参考结果，不要说得像绝对真理，语气要像"仅供参考"的建议
- recommendedDirections：3-5 个适合的岗位/方向，每个要说明为什么（结合具体的测试结果，比如"你在XX维度得分高，说明..."）
- strengths：结合测试结果，求职时可以着重展现的个人优势
- cautions：需要注意的地方，比如某些方向可能不太匹配、或者性格上求职/面试时需要提前准备应对的点
- summary：两三句总体建议

全部用中文。`;

  const config = await getUserAiConfig(user.id);
  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        recommendedDirections: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              direction: { type: "STRING" },
              reason: { type: "STRING" },
            },
            required: ["direction", "reason"],
          },
        },
        strengths: { type: "ARRAY", items: { type: "STRING" } },
        cautions: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["summary", "recommendedDirections", "strengths", "cautions"],
    },
  });

  const parsed = careerFitAnalysisSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.careerFitAnalysis.upsert({
    where: { userId: user.id },
    create: { userId: user.id, content: parsed.data },
    update: { content: parsed.data },
  });

  revalidatePath("/personality");
  return parsed.data;
}
