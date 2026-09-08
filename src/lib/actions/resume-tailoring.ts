"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const tailoringSchema = z.object({
  summary: z.string(),
  rewrites: z.array(
    z.object({
      original: z.string(),
      suggested: z.string(),
      reason: z.string(),
    })
  ),
});

export type ResumeTailoring = z.infer<typeof tailoringSchema>;

/**
 * Bullet-level "改写前 → 改写后" suggestions, not a full rewrite — the point
 * is rephrasing/quantifying/reordering what's already true on the resume to
 * speak more directly to this JD, never inventing new experience. Text-based
 * like cover-letter.ts (getResumeContext, no file-capable provider required)
 * since judging phrasing doesn't need to see the actual PDF layout the way
 * resume-match.ts's file-based scoring does.
 */
export async function generateResumeTailoring(
  positionId: string,
  resumeVersionId: string
): Promise<ActionResult<ResumeTailoring>> {
  return toActionResult(() => run(positionId, resumeVersionId));
}

async function run(positionId: string, resumeVersionId: string): Promise<ResumeTailoring> {
  const user = await requireUser();

  const position = await db.position.findFirst({
    where: { id: positionId, userId: user.id },
    include: { company: true },
  });
  if (!position) throw new UserFacingError("未找到该岗位");

  const { resumeText } = await getResumeContext(resumeVersionId, user.id);

  // Reuse whatever gap analysis the match dialog already produced, if any —
  // grounds the rewrite suggestions in the same "missing/partial" JD
  // requirements the user already saw, instead of the AI re-deriving gaps
  // from scratch and possibly disagreeing with the match breakdown.
  const existingMatch = await db.positionMatch.findUnique({
    where: { positionId_resumeVersionId: { positionId, resumeVersionId } },
    select: { result: true },
  });
  const gapsNote = (() => {
    const result = existingMatch?.result as
      | { breakdown?: { requirement: string; verdict: string }[] }
      | null;
    const gaps = result?.breakdown
      ?.filter((b) => b.verdict !== "match")
      .map((b) => b.requirement);
    return gaps && gaps.length > 0
      ? `\n之前的岗位匹配分析发现简历在这些要求上没有完全对上，重点看看能不能通过改写现有内容来更贴合（不是编造新经历）：\n${gaps.map((g) => `- ${g}`).join("\n")}`
      : "";
  })();

  const jobDescription = [
    `公司：${position.company.name}`,
    `岗位：${position.title}`,
    position.track ? `方向：${position.track}` : null,
    position.jdText ? `\nJD 正文：\n${position.jdText.slice(0, 6000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `你在帮一个中国应届生把简历改得更贴合这个岗位的 JD，但不是重写整份简历，而是挑简历里已有的、值得针对这个 JD 调整表述的具体句子/要点，给出"改写前 → 改写后"的对照建议。

目标岗位：
${jobDescription}
${!position.jdText ? "\n注意：没有 JD 正文，只能依据岗位名称和方向判断。" : ""}
${gapsNote}

候选人当前简历内容：
${resumeText}

要求：
- 只挑简历里真实存在的句子/要点做改写，original 字段必须是简历原文里能找到的内容（或非常接近的复述），不要凭空编一句原文里没有的话当作"原文"
- suggested 是改写后的版本——可以是：把笼统的描述改成量化的（比如"负责后端开发"→"独立开发XX模块"，数字必须能从原简历内容合理推断或原本就有，不能瞎编数字）、把跟这个 JD 不太相关的措辞换成 JD 里用的关键词、调整语序突出跟 JD 最相关的部分
- reason 说清楚这条改写对应 JD 里的哪个要求，为什么这么改更好
- 不要建议编造简历里完全没有的经历、项目或技能——这是改写现有内容的表达方式，不是编造新履历
- 挑 4-8 条最值得改的，不用每句话都改
- summary 一句话总述这份简历相对这个 JD 整体需要往哪个方向调整
- 全部用中文

返回 summary 和 rewrites 数组。`;

  const config = await getUserAiConfig(user.id);
  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        rewrites: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              original: { type: "STRING" },
              suggested: { type: "STRING" },
              reason: { type: "STRING" },
            },
            required: ["original", "suggested", "reason"],
          },
        },
      },
      required: ["summary", "rewrites"],
    },
  });

  const parsed = tailoringSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.resumeTailoring.upsert({
    where: { positionId_resumeVersionId: { positionId, resumeVersionId } },
    create: { userId: user.id, positionId, resumeVersionId, result: parsed.data },
    update: { result: parsed.data },
  });

  revalidatePath("/pool");
  return parsed.data;
}
