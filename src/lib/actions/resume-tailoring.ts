"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { parseApplicationProfile } from "@/lib/application-profile";
import { sanitizeResumeBody, tailoredResumeSchema, type TailoredResume } from "@/lib/tailored-resume";
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

  // Merge: the same row also holds the generated 定制简历 (below).
  const existing = await db.resumeTailoring.findUnique({
    where: { positionId_resumeVersionId: { positionId, resumeVersionId } },
    select: { result: true },
  });
  const merged = { ...((existing?.result as Record<string, unknown> | null) ?? {}), ...parsed.data };
  await db.resumeTailoring.upsert({
    where: { positionId_resumeVersionId: { positionId, resumeVersionId } },
    create: { userId: user.id, positionId, resumeVersionId, result: merged as Prisma.InputJsonValue },
    update: { result: merged as Prisma.InputJsonValue },
  });

  revalidatePath("/pool");
  return parsed.data;
}

/**
 * 定制简历: a complete one-page resume for this JD, assembled only from facts
 * already on the resume and in 网申资料 — reordered, trimmed and reworded
 * toward the JD, never invented. Education comes verbatim from 网申资料 at
 * render time, so the AI never touches school names, degrees or dates.
 */
export async function generateTailoredResume(
  positionId: string,
  resumeVersionId: string
): Promise<ActionResult<TailoredResume>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const position = await db.position.findFirst({ where: { id: positionId, userId: user.id }, include: { company: true } });
    if (!position) throw new UserFacingError("未找到该岗位");
    const { resumeText } = await getResumeContext(resumeVersionId, user.id);
    const profile = parseApplicationProfile(user.applicationProfile);
    const existing = await db.resumeTailoring.findUnique({
      where: { positionId_resumeVersionId: { positionId, resumeVersionId } },
      select: { result: true },
    });
    const previous = (existing?.result as { rewrites?: { original: string; suggested: string }[] } | null) ?? null;
    const rewrites = previous?.rewrites?.length
      ? `\n之前针对这个岗位给过的改写建议（可以直接采用）：\n${previous.rewrites.map((r) => `- ${r.original} → ${r.suggested}`).join("\n")}`
      : "";
    const facts = [
      ...profile.experiences.map((x, i) => `实习/工作${i + 1}：${[x.company, x.role, [x.start, x.end].filter(Boolean).join("~")].filter(Boolean).join(" / ")}${x.description ? `——${x.description}` : ""}`),
      ...profile.projects.map((p, i) => `项目${i + 1}：${[p.name, p.role, [p.start, p.end].filter(Boolean).join("~")].filter(Boolean).join(" / ")}${p.description ? `；描述：${p.description}` : ""}${p.responsibilities ? `；职责与成果：${p.responsibilities}` : ""}`),
    ].join("\n");

    const prompt = `你在帮一个中国应届生针对下面这个岗位，整理出一份完整的一页中文简历。只能使用候选人简历原文和网申资料里已有的事实：可以挑选、排序、精简、换成 JD 里的关键词、把已有成果写得更具体，但绝不能编造经历、项目、技能、数字、奖项或时间。

目标岗位：
公司：${position.company.name}
岗位：${position.title}${position.track ? `\n方向：${position.track}` : ""}
${position.jdText ? `JD 正文：\n${position.jdText.slice(0, 6000)}` : "（没有 JD 正文，只能依据岗位名称判断）"}
${rewrites}

候选人简历原文：
${resumeText.slice(0, 12000)}

网申资料里的经历（和简历原文互相补充，以这里的公司名、时间为准）：
${facts || "（无）"}

输出要求：
- headline：求职意向，写这个岗位的名称或方向，不超过 20 字
- summary：个人优势，2-3 句，紧扣 JD 最看重的 2-3 点，只写有事实支撑的内容
- experiences：实习/工作经历，按与 JD 相关度排序，最多 4 段；title=公司，subtitle=职位，start/end 用 yyyy.MM（没有就留空，不要猜），bullets 每段 2-4 条，以动词开头，保留原有数字，不新增数字
- projects：项目经历，按相关度排序，最多 3 个；title=项目名，subtitle=角色，其余同上
- skills：专业技能，3-6 条，每条一类（如“数据分析：SQL、Python（pandas）”），只写简历里出现过的
- awards：荣誉与证书，只写简历里出现过的，没有就给空数组
- 不要输出教育经历（会直接用网申资料里的）
- 全部用中文，除非是专有名词`;

    const config = await getUserAiConfig(user.id);
    const entry = {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        subtitle: { type: "STRING" },
        start: { type: "STRING" },
        end: { type: "STRING" },
        bullets: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["title", "subtitle", "start", "end", "bullets"],
    } as const;
    const raw = await callTextAi({
      config,
      prompt,
      thinkingBudget: 2048,
      timeoutMs: 120000,
      schema: {
        type: "OBJECT",
        properties: {
          headline: { type: "STRING" },
          summary: { type: "STRING" },
          experiences: { type: "ARRAY", items: entry },
          projects: { type: "ARRAY", items: entry },
          skills: { type: "ARRAY", items: { type: "STRING" } },
          awards: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["headline", "summary", "experiences", "projects", "skills", "awards"],
      },
    });
    const parsed = tailoredResumeSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

    // A fresh generation replaces any hand-edited version of the old one.
    const merged = { ...((existing?.result as Record<string, unknown> | null) ?? {}), document: parsed.data, documentBody: null };
    await db.resumeTailoring.upsert({
      where: { positionId_resumeVersionId: { positionId, resumeVersionId } },
      create: { userId: user.id, positionId, resumeVersionId, result: merged as Prisma.InputJsonValue },
      update: { result: merged as Prisma.InputJsonValue },
    });
    return parsed.data;
  });
}

/** Keeps the applicant's in-preview edits (sanitised body HTML). */
export async function saveTailoredResumeBody(positionId: string, resumeVersionId: string, body: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const existing = await db.resumeTailoring.findFirst({
      where: { positionId, resumeVersionId, userId: user.id },
      select: { id: true, result: true },
    });
    if (!existing) throw new UserFacingError("先生成定制简历");
    const result = { ...((existing.result as Record<string, unknown> | null) ?? {}), documentBody: sanitizeResumeBody(body) };
    await db.resumeTailoring.update({ where: { id: existing.id }, data: { result: result as Prisma.InputJsonValue } });
    return null;
  });
}
