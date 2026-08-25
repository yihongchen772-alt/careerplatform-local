"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import {
  getFileSearchKey,
  generateGroundedText,
  generateStructuredWithFile,
} from "@/lib/ai-file-search";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const insightSchema = z.object({
  salary: z.string().nullish(),
  workLife: z.string().nullish(),
  interview: z.string().nullish(),
  culture: z.string().nullish(),
  recent: z.string().nullish(),
  confidence: z.enum(["high", "medium", "low"]),
  caveat: z.string(),
});

export type CompanyInsight = z.infer<typeof insightSchema>;

/**
 * "What's this job actually like" — salary reality, overtime, interview
 * difficulty, culture. Uses the provider's own web-search grounding over
 * publicly indexed pages (知乎/脉脉/看准/新闻, plus whatever 小红书 content
 * search engines have indexed).
 *
 * Deliberately does NOT scrape 小红书 (or any login-walled platform)
 * directly: there is no public content-search API for third parties, the
 * content sits behind a login with request-signing anti-bot, and scraping it
 * would breach their terms and break constantly. Everything here comes from
 * pages that are publicly reachable.
 *
 * Everything returned is hearsay by nature, so the model is asked to grade
 * its own confidence and state what it couldn't find, rather than filling
 * gaps with plausible-sounding invention.
 */
export async function researchCompanyInsight(
  positionId: string
): Promise<ActionResult<CompanyInsight>> {
  return toActionResult(async () => {
    const user = await requireUser();

    const position = await db.position.findFirst({
      where: { id: positionId, userId: user.id },
      include: { company: true },
    });
    if (!position) throw new UserFacingError("未找到该岗位");

    const config = await getFileSearchKey(user.id);
    if (!config) {
      throw new UserFacingError(
        "岗位口碑调研需要联网搜索，去账号设置配置一个 Gemini、Claude 或 OpenAI 的 Key（DeepSeek/Kimi/Qwen 不支持联网搜索）"
      );
    }

    const target = [
      position.company.name,
      position.title,
      position.department ? `（${position.department}）` : "",
      position.location ? `工作地点${position.location}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const searchText = await generateGroundedText({
      config,
      timeoutMs: 90000,
      prompt: `帮我在网上查一下这个岗位的真实情况，我是应届生正在考虑要不要投：

${target}

我想知道：
1. 薪资水平：这家公司这个岗位校招/应届生的实际给薪范围，有没有网上公开的爆料或统计
2. 加班情况：作息制度（大小周？965/955/996？）、实际加班强度、有没有加班费
3. 面试难度和流程：几轮、考什么、通过率的说法
4. 团队氛围和成长：晋升、带教、业务稳定性
5. 最近动态：有没有裁员/扩招/业务调整/口碑变化的新闻

要求：
- 说明每条信息是从哪类来源看到的（官方公告 / 新闻报道 / 员工爆料社区 / 求职者分享）
- 员工爆料和匿名分享要标明是主观说法，可能以偏概全
- **查不到就明确说查不到，绝对不要用常识或对同类公司的印象来填充**
- 如果搜到的信息明显过时（比如两三年前的），要说明时间`,
    });

    const raw = await generateStructuredWithFile({
      config,
      thinkingBudget: 512,
      timeoutMs: 60000,
      prompt: `把下面这段岗位调研文字整理成结构化字段。

调研文字：
${searchText}

要求：
- salary：薪资水平，包含范围和信息来源类型；查不到填 null
- workLife：加班/作息情况；查不到填 null
- interview：面试流程和难度；查不到填 null
- culture：团队氛围、晋升、成长空间；查不到填 null
- recent：最近的相关动态；没有填 null
- confidence：整体可信度。high=有官方或多个一致来源；medium=有几条爆料但不完全一致；low=几乎没查到针对这家公司这个岗位的具体信息
- caveat：一到两句话说明这份调研的局限（比如"主要来自匿名爆料，样本少""只查到公司整体情况，没有这个岗位的具体信息"）
- 不要编造。原文说查不到的，就填 null，不要改写成模糊的正面描述
- 全部用中文`,
      schema: {
        type: "OBJECT",
        properties: {
          salary: { type: "STRING", nullable: true },
          workLife: { type: "STRING", nullable: true },
          interview: { type: "STRING", nullable: true },
          culture: { type: "STRING", nullable: true },
          recent: { type: "STRING", nullable: true },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          caveat: { type: "STRING" },
        },
        required: ["salary", "workLife", "interview", "culture", "recent", "confidence", "caveat"],
      },
    });

    const parsed = insightSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");
    return parsed.data;
  });
}
