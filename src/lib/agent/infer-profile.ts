import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { callTextAi } from "@/lib/ai-providers";
import { getAgentConfig } from "@/lib/agent/config";
import { describeApplicationProfile, parseApplicationProfile } from "@/lib/application-profile";
import { getResumeContext } from "@/lib/resume-context";

// 求职方向 / 期望城市 / 擅长技能 were blank, so 小欧 and the match scores
// knew nothing about the applicant's aims. They are what the applications
// already show (98 投递 in 电气 / 自动化 …), so 小欧 works them out once,
// writes only the blanks and says so — with 撤销, like everything learned.

export const INFER_FIELDS = { targetTrack: "求职方向", preferredCities: "期望城市", skills: "擅长的技术 / 技能" } as const;
export type InferField = keyof typeof INFER_FIELDS;

const inferredSchema = z.object({
  at: z.string(),
  /** What was written, so 撤销 only takes back what is still exactly that. */
  fields: z.record(z.string(), z.string()),
  memoryIds: z.array(z.string()).default([]),
  undone: z.boolean().default(false),
  /** Closed on 总览 (or taken back): the notice is not shown again. */
  seen: z.boolean().default(false),
});
export type InferredRecord = z.infer<typeof inferredSchema>;

export function parseInferred(raw: unknown): InferredRecord | null {
  const parsed = inferredSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Enough applications to say something about the direction. */
const MIN_APPLICATIONS = 5;

const resultSchema = z.object({
  targetTrack: z.string().trim().max(40).default(""),
  preferredCities: z.string().trim().max(60).default(""),
  skills: z.string().trim().max(200).default(""),
  memories: z.array(z.string().trim().min(4).max(120)).max(3).default([]),
});

/** Whether there is anything to work out: a blank field and enough applications. */
export async function inferenceDue(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { targetTrack: true, preferredCities: true, skills: true, agentInferred: true } });
  if (!user || user.agentInferred) return false;
  if ((Object.keys(INFER_FIELDS) as InferField[]).every((key) => user[key]?.trim())) return false;
  return (await db.application.count({ where: { userId } })) >= MIN_APPLICATIONS;
}

/**
 * Works out the blanks from the applications and the resume, writes them in
 * and records it (also when nothing could be said, so it runs once).
 * Returns what was written; null when nothing was due or no AI is set up.
 */
export async function inferProfile(userId: string): Promise<InferredRecord | null> {
  if (!(await inferenceDue(userId))) return null;
  const config = await getAgentConfig(userId);
  if (!config) return null;
  const [user, applications, resume] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    db.application.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 120, select: { title: true, company: { select: { name: true } }, position: { select: { location: true, track: true } } } }),
    db.resumeVersion.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], select: { id: true } }),
  ]);
  const resumeText = resume ? await getResumeContext(resume.id, userId).then((context) => context.resumeText.slice(0, 6000)).catch(() => "") : "";
  const lines = applications.map((app) => [app.company.name, app.title, app.position?.location, app.position?.track].filter(Boolean).join(" · "));
  const raw = await callTextAi({
    config,
    prompt: `根据一位应届生投过的岗位和简历，推断他的求职偏好，用来填他没填的个人资料。只根据下面的数据，看不出来的留空字符串，不要猜。

他投过的 ${applications.length} 个岗位（公司 · 岗位 · 地点 · 方向）：
${lines.join("\n")}

简历（节选）：
${resumeText || "（没有）"}

网申资料：
${describeApplicationProfile(parseApplicationProfile(user.applicationProfile)).slice(0, 3000) || "（没有）"}

要求：
- targetTrack：主要的求职方向，1-3 个，用顿号分隔，如「电气工程、自动化、嵌入式」。按投递最多的方向写。
- preferredCities：投递里最常出现的工作城市，最多 4 个，逗号分隔；地点信息太少就留空。
- skills：简历里明确写的核心技能，逗号分隔，最多 10 个。
- memories：最多 3 句对以后给建议有用、而且数据里确实看得出来的事实，比如「投递以制造业、能源国企为主」「同时投了国内和新加坡的岗位」。不要写姓名电话等个人信息，不要写评价。`,
    thinkingBudget: 512,
    timeoutMs: 60000,
    schema: {
      type: "OBJECT",
      properties: {
        targetTrack: { type: "STRING" }, preferredCities: { type: "STRING" }, skills: { type: "STRING" },
        memories: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["targetTrack", "preferredCities", "skills", "memories"],
    },
  });
  const parsed = resultSchema.safeParse(raw);
  const result = parsed.success ? parsed.data : { targetTrack: "", preferredCities: "", skills: "", memories: [] };
  return db.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { targetTrack: true, preferredCities: true, skills: true, agentInferred: true } });
    if (current.agentInferred) return null;
    const fields: Record<string, string> = {};
    for (const key of Object.keys(INFER_FIELDS) as InferField[]) if (!current[key]?.trim() && result[key]) fields[key] = result[key];
    const existing = new Set((await tx.agentMemory.findMany({ where: { userId }, select: { content: true } })).map((memory) => memory.content));
    const memoryIds: string[] = [];
    for (const content of result.memories) {
      if (existing.has(content)) continue;
      memoryIds.push((await tx.agentMemory.create({ data: { userId, content } })).id);
    }
    const record: InferredRecord = { at: new Date().toISOString(), fields, memoryIds, undone: false, seen: !Object.keys(fields).length && !memoryIds.length };
    await tx.user.update({ where: { id: userId }, data: { ...fields, agentInferred: record as unknown as Prisma.InputJsonValue } });
    return record;
  });
}

/** 撤销: blanks again what is still as written, and drops the memories it added. */
export async function undoInferredProfile(userId: string) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { targetTrack: true, preferredCities: true, skills: true, agentInferred: true } });
    const record = parseInferred(user.agentInferred);
    if (!record || record.undone) return { undone: 0, kept: 0 };
    const data: Record<string, null> = {};
    let kept = 0;
    for (const [key, value] of Object.entries(record.fields)) {
      if (!(key in INFER_FIELDS)) continue;
      if (user[key as InferField] === value) data[key] = null;
      else kept++;
    }
    await tx.agentMemory.deleteMany({ where: { userId, id: { in: record.memoryIds } } });
    await tx.user.update({ where: { id: userId }, data: { ...data, agentInferred: { ...record, undone: true, seen: true } as unknown as Prisma.InputJsonValue } });
    return { undone: Object.keys(data).length, kept };
  });
}

export async function markInferredSeen(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { agentInferred: true } });
  const record = parseInferred(user.agentInferred);
  if (record && !record.seen) await db.user.update({ where: { id: userId }, data: { agentInferred: { ...record, seen: true } as unknown as Prisma.InputJsonValue } });
}

/** The notice for 总览: what 小欧 filled in, until it is closed or taken back. */
export async function loadInferredNotice(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { agentInferred: true } });
  const record = parseInferred(user?.agentInferred);
  const due = !user?.agentInferred && (await inferenceDue(userId));
  return { due, record: record && !record.seen && !record.undone ? record : null };
}
