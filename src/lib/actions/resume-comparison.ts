"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { computeResumeComparison } from "@/lib/analytics";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const narrativeSchema = z.object({ narrative: z.string() });

/**
 * Pure statistics (computeResumeComparison) already tell you the numbers;
 * this just narrates them — and is deliberately told NOT to guess *why* one
 * version does better (it doesn't know what actually changed between
 * versions, and inventing a plausible-sounding reason would be fabrication,
 * not analysis). It's restricted to what the numbers themselves show.
 */
export async function generateResumeComparisonNarrative(): Promise<ActionResult<string>> {
  return toActionResult(async () => {
    const user = await requireUser();

    const applications = await db.application.findMany({
      where: { userId: user.id },
      include: {
        resumeVersion: { select: { name: true } },
        stageHistory: { select: { stage: true } },
      },
    });
    const rows = computeResumeComparison(applications);
    if (rows.length < 2) {
      throw new UserFacingError("至少要有 2 个简历版本各自投递过，才有得比");
    }

    const table = rows
      .map(
        (r) =>
          `${r.name}：投递 ${r.total}，笔试 ${r.assessment}（${Math.round(r.assessmentRate * 100)}%），面试 ${r.interview}（${Math.round(r.interviewRate * 100)}%），Offer ${r.offers}${r.smallSample ? "（样本少于 5 条，参考价值有限）" : ""}`
      )
      .join("\n");

    const config = await getUserAiConfig(user.id);
    const prompt = `下面是同一个人不同版本简历各自的投递效果统计：
${table}

请用 2-4 句话分析：
- 重点看"面试"这一步的转化率，不要只看投递数量多不多——投得多不代表简历好
- 样本少于 5 条的版本要明确说"数据还不够，先别下结论"，不要硬给建议
- 只根据这些数字本身能看出的趋势说话，用"数据显示""目前来看"这类措辞，不要编造版本之间具体改了什么内容导致差异（你并不知道这些简历版本之间实际改了什么，猜一个"项目描述写得更好了"这种理由是编造，不是分析）
- 如果确实有版本表现明显更好，可以建议"优先用这个版本投递"，但不要说"应该停用某个版本"这种绝对结论，除非样本量都足够大
- 全部用中文

返回 narrative 字段。`;

    const raw = await callTextAi({
      config,
      prompt,
      thinkingBudget: 512,
      schema: {
        type: "OBJECT",
        properties: { narrative: { type: "STRING" } },
        required: ["narrative"],
      },
    });

    const parsed = narrativeSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

    await db.resumeComparisonSummary.upsert({
      where: { userId: user.id },
      create: { userId: user.id, narrative: parsed.data.narrative },
      update: { narrative: parsed.data.narrative },
    });

    revalidatePath("/insights");
    return parsed.data.narrative;
  });
}
