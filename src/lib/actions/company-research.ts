"use server";

import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getSearchKey, generateGroundedText } from "@/lib/ai-file-search";
import { callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const researchSchema = z.object({
  careerUrl: z.string().nullish(),
  industry: z.string().nullish(),
  sector: z.string().nullish(),
  size: z.string().nullish(),
  note: z.string().nullish(),
});

export type CompanyResearch = z.infer<typeof researchSchema>;

/**
 * Two-pass: first a search-grounded call so the AI actually looks the
 * company up on the public web instead of relying on (possibly stale)
 * training data, then a second schema-enforced pass to turn that free-text
 * answer into fields the form can use. Deliberately does NOT scrape or ask
 * for content from login-walled platforms (e.g. 小红书) — those require
 * auth and block automated access; this only uses what the provider's own
 * public web search grounding can see, which is officially published pages.
 */
export async function researchCompany(name: string): Promise<ActionResult<CompanyResearch>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) throw new UserFacingError("先填公司名称");

    const config = await getSearchKey(user.id);
    if (!config) {
      throw new UserFacingError(
        "AI 联网搜索需要配置一个 Qwen、Gemini、Claude 或 OpenAI 的 API Key（去账号设置 → AI 设置里加一个）"
      );
    }

    const searchText = await generateGroundedText({
      config,
      prompt: `帮我在网上搜一下"${trimmed}"这家公司，面向中国应届生求职场景，我需要：
- 官方的校园招聘或社会招聘入口网址（不要猜测，搜不到就说没找到）
- 所属行业和细分领域
- 大致的公司规模（比如"1万人以上的大厂""几百人的初创公司"这种）
- 如果搜到最近的秋招/校招相关动态（招聘季节、扩招/缩招消息等），简单说一下，没有就不用提

请说明信息来源（搜到的是官网还是第三方报道），不确定的地方要说明不确定，不要编造网址。`,
    });

    const raw = await callTextAi({
      config,
      thinkingBudget: 512,
      timeoutMs: 45000,
      prompt: `把下面这段关于一家公司的调研文字，整理成结构化字段。

调研文字：
${searchText}

要求：
- careerUrl：官方招聘入口网址，文字里没有明确给出真实网址的就填 null，不要编造
- industry：细分行业，比如"互联网/电商云计算"
- sector：大类行业，比如"互联网""制造业""金融"
- size：公司规模的简短描述
- note：一两句话补充信息（比如招聘季节、最新动态），没有就填 null
- 全部用中文`,
      schema: {
        type: "OBJECT",
        properties: {
          careerUrl: { type: "STRING", nullable: true },
          industry: { type: "STRING", nullable: true },
          sector: { type: "STRING", nullable: true },
          size: { type: "STRING", nullable: true },
          note: { type: "STRING", nullable: true },
        },
        required: ["careerUrl", "industry", "sector", "size", "note"],
      },
    });

    const parsed = researchSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

    return parsed.data;
  });
}
