"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getSearchKey, generateGroundedText } from "@/lib/ai-file-search";
import { callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const analysisSchema = z.object({
  verdict: z.string(),
  marketComparison: z.string().nullish(),
  negotiationPoints: z.array(z.string()),
  risks: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  caveat: z.string(),
});

export type OfferAnalysis = z.infer<typeof analysisSchema>;

/**
 * "Is this offer good, and how do I negotiate it" — same shape as
 * researchCompanyInsight (company-insight.ts): grounded web search first,
 * then a second call to structure that text, both honest about what
 * couldn't be found rather than filling gaps with a plausible-sounding
 * guess. Not cached — offer terms and market data both drift, and this
 * isn't called often enough to be worth a table for it (see DailyDigest/
 * WeeklyReview for the "worth caching" bar: something re-read on every page
 * load; this is a deliberate, occasional click).
 */
export async function analyzeOffer(applicationId: string): Promise<ActionResult<OfferAnalysis>> {
  return toActionResult(async () => {
    const user = await requireUser();

    const application = await db.application.findFirst({
      where: { id: applicationId, userId: user.id },
      include: { company: true, position: true },
    });
    if (!application) throw new UserFacingError("未找到这条投递记录");

    const config = await getSearchKey(user.id);
    if (!config) {
      throw new UserFacingError(
        "分析 offer 需要联网查市场行情，去账号设置配置一个 Qwen、Gemini、Claude 或 OpenAI 的 Key（DeepSeek/Kimi 的接口不支持联网搜索）"
      );
    }

    const offerFacts =
      [
        application.salaryMin || application.salaryMax
          ? `月薪 ${application.salaryMin ?? "?"}-${application.salaryMax ?? "?"}K`
          : null,
        application.offerAnnualTotal ? `年包约 ${application.offerAnnualTotal} 万` : null,
        application.commuteMinutes != null ? `单程通勤 ${application.commuteMinutes} 分钟` : null,
        application.overtimeNote ? `作息：${application.overtimeNote}` : null,
        application.growthNote ? `发展空间：${application.growthNote}` : null,
        application.offerNote ? `备注：${application.offerNote}` : null,
      ]
        .filter(Boolean)
        .join("；") || "还没填具体的 offer 条件";

    const target = [application.company.name, application.title, application.position?.location]
      .filter(Boolean)
      .join(" ");

    const searchText = await generateGroundedText({
      config,
      timeoutMs: 90000,
      prompt: `我是应届生，拿到了这个 offer，想知道值不值、有没有谈的空间：

${target}
我拿到的条件：${offerFacts}

帮我联网查一下：
1. 这家公司这个岗位/职级校招应届生的市场薪资范围（尽量找同城市、同职级的数据）
2. 这家公司在薪资谈判上的口碑——好不好谈、有没有应届生成功谈涨薪的分享、谈的空间大概多少
3. 这家公司/这个业务线最近的经营状况（扩招/裁员/业务收缩等，会影响谈判筹码）

要求：
- 说明信息来源类型（官方/新闻/求职者分享）
- 查不到就明确说查不到，不要用同类公司的印象填充
- 过时信息（两三年前）要说明时间`,
    });

    const raw = await callTextAi({
      config,
      thinkingBudget: 1024,
      timeoutMs: 60000,
      prompt: `一个应届生拿到了下面这个 offer，联网查到了市场行情信息，帮他判断这个 offer 值不值、可以怎么跟 HR 谈。

他拿到的条件：${offerFacts}

联网查到的市场行情：
${searchText}

请给出：
- verdict：一到两句话，结合市场行情判断这个 offer 处于什么水平（明显高于市场/持平/偏低等），要基于查到的数据，没查到具体数据就说清楚是基于什么有限信息做的粗略判断
- marketComparison：市场行情的具体对比说明（同城市/同职级大概什么范围），查不到填 null
- negotiationPoints：可以在跟 HR 谈的时候提的具体点，比如"同城市同职级市场价在 X-Y，可以问问有没有空间"、"如果有其他 offer 可以提一下作为筹码"，2-4条，要具体可执行，不要空话
- risks：这个 offer 里值得注意的风险点，比如条件模糊、口头承诺没写进合同、试用期条款等——基于实际给的信息判断，没有明显风险就给空数组，不要硬找
- confidence：整体判断的可信度，参考依据是查到的市场数据是否充分
- caveat：一到两句话说明这份分析的局限
- 不要编造查不到的数字。全部用中文`,
      schema: {
        type: "OBJECT",
        properties: {
          verdict: { type: "STRING" },
          marketComparison: { type: "STRING", nullable: true },
          negotiationPoints: { type: "ARRAY", items: { type: "STRING" } },
          risks: { type: "ARRAY", items: { type: "STRING" } },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          caveat: { type: "STRING" },
        },
        required: [
          "verdict",
          "marketComparison",
          "negotiationPoints",
          "risks",
          "confidence",
          "caveat",
        ],
      },
    });

    const parsed = analysisSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");
    return parsed.data;
  });
}
