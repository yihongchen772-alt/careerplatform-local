import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { memoryContent, type MemoryCapture, type MemoryContent } from "@/lib/application-memory";
import { parseApplicationProfile } from "@/lib/application-profile";
import { learnFromPage, profileKeyForLabel, type LearnedNotice } from "@/lib/profile-learning";
import { ACCOUNT_PAGE, isNoiseChange, visiblePendingWhere, type PendingAnswer } from "@/lib/pending-application-change";

// 待核对 rows from before the browser learned by itself (or from before a
// list existed — 校园经历, 语言成绩) were left there, so the same boxes kept
// being typed by hand. They are put through the same learning now, once:
// what fills a blank in 网申资料 is written in with 撤销, the rest stays.

const CADRE_ROLE = /^(?:学生)?干部(?:名称|职务)$|^(?:担任|所任)(?:的)?(?:学生)?(?:干部)?职务$|^学生干部职务$/;
const CADRE_LEVEL = /^(?:干部)?(?:层级|级别)$|^干部(?:层级|级别)$/;
// A box named after one exam ("IELTS", "六级成绩") holds that exam's score.
const EXAM = /ielts|雅思|toefl|托福|cet\s*-?\s*[46]|[四六]级|专[四八]|\bgre\b|gmat|toeic|托业/i;
const EXAM_NAMES: Array<[RegExp, string]> = [[/ielts|雅思/i, "雅思"], [/toefl|托福/i, "托福"], [/cet\s*-?\s*6|六级/i, "CET-6"], [/cet\s*-?\s*4|四级/i, "CET-4"], [/专八|专业?(?:英语)?八级/, "专业八级"], [/专四/, "专业四级"], [/\bgre\b/i, "GRE"], [/gmat/i, "GMAT"], [/toeic|托业/i, "托业"]];

const bare = (label: string) => label.replace(/[\s*＊:：]/g, "");

/**
 * Turns one page's pending answers into what 网申资料 keeps: 常问字段 by
 * their label, 干部名称 + 干部层级 pairs into 校园经历 rows, exam scores
 * into 语言成绩 rows. Returns which pending rows each capture came from.
 */
export function backlogCaptures(rows: Array<{ id: string; kind: string; label: string; payload: unknown }>) {
  const answers: Array<{ answer: string; profileKey?: string; rowId: string }> = [];
  const records: Array<MemoryCapture & { rowIds: string[] }> = [];
  const roles: Array<{ id: string; value: string }> = [];
  const levels: Array<{ id: string; value: string }> = [];
  for (const row of rows) {
    if (row.kind === "record") {
      const record = row.payload as MemoryCapture;
      if (memoryContent(record.category, record.content)) records.push({ ...record, rowIds: [row.id] });
      continue;
    }
    const answer = row.payload as PendingAnswer;
    if (answer.kind === "essay") continue;
    const label = bare(answer.questionLabel || row.label);
    const value = answer.answer.trim();
    if (!value) continue;
    if (CADRE_ROLE.test(label)) { roles.push({ id: row.id, value }); continue; }
    if (CADRE_LEVEL.test(label)) { levels.push({ id: row.id, value }); continue; }
    if (EXAM.test(label) && /^\d{1,3}(?:\.\d)?$/.test(value)) {
      const name = EXAM_NAMES.find(([pattern]) => pattern.test(label))?.[1];
      if (name) records.push({ category: "language", content: { name, language: "", score: value, date: "" }, captureKey: `backlog:${name}`, rowIds: [row.id] });
      continue;
    }
    const profileKey = answer.profileKey || profileKeyForLabel(answer.questionLabel || row.label) || undefined;
    if (profileKey) answers.push({ answer: value, profileKey, rowId: row.id });
  }
  // The page asked for each 学生干部 as 名称 + 层级, in page order.
  roles.forEach((role, index) => {
    const level = levels[index];
    const content: MemoryContent = { name: role.value, role: role.value, level: level?.value || "", start: "", end: "", description: "" };
    records.push({ category: "campus", content, captureKey: `backlog:cadre:${index}`, rowIds: [role.id, ...(level ? [level.id] : [])] });
  });
  return { answers, records };
}

/** What the backlog wrote that has not been looked at yet (notice + 撤销). */
export async function loadBacklogNotices(userId: string, client: Prisma.TransactionClient = db): Promise<LearnedNotice[]> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { applicationProfile: true } });
  return parseApplicationProfile(user?.applicationProfile).learned.filter((entry) => !entry.seen && !entry.undone).map((entry) => ({ id: entry.id, label: entry.label }));
}

export async function markBacklogSeen(userId: string, ids: string[]) {
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { applicationProfile: true } });
    const profile = parseApplicationProfile(user.applicationProfile);
    let changed = false;
    for (const entry of profile.learned) if (ids.includes(entry.id) && !entry.seen) { entry.seen = true; changed = true; }
    if (changed) await tx.user.update({ where: { id: userId }, data: { applicationProfile: profile as Prisma.InputJsonValue } });
  });
}

/** Runs the backlog once per load; rows it learned from become 已记住 (accepted). */
export async function learnFromBacklog(tx: Prisma.TransactionClient, userId: string): Promise<LearnedNotice[]> {
  const pending = (await tx.pendingApplicationChange.findMany({ where: visiblePendingWhere(userId), orderBy: { createdAt: "asc" } }))
    .filter((row) => !isNoiseChange(row) && !ACCOUNT_PAGE.test(row.sourceUrl));
  if (!pending.length) return [];
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  let profile = parseApplicationProfile(user.applicationProfile);
  let preferredCities = user.preferredCities;
  const memories = (await tx.applicationMemory.findMany({ where: { userId } })).map((memory) => ({ category: memory.category, content: (memory.content ?? {}) as MemoryContent }));
  const learned: LearnedNotice[] = [];
  const consumed = new Set<string>();
  let changed = false;
  const bySource = new Map<string, typeof pending>();
  for (const row of pending) bySource.set(row.sourceUrl, [...(bySource.get(row.sourceUrl) ?? []), row]);
  // Something taken back once (撤销) is not written in again from another old page.
  const refused = new Set(profile.learned.filter((entry) => entry.undone).map((entry) => entry.ref));
  for (const [sourceUrl, rows] of bySource) {
    const captured = backlogCaptures(rows);
    const answers = captured.answers.filter((answer) => !refused.has(answer.profileKey === "preferredCities" ? "user:preferredCities" : `extras:${answer.profileKey}`));
    const records = captured.records.filter((record) => !refused.has(`row:${record.category}`));
    if (!answers.length && !records.length) continue;
    const result = learnFromPage(profile, { preferredCities }, {
      answers, records, sourceUrl, variantActive: false, effectiveExtras: profile.extras, memories,
    });
    answers.forEach((answer, index) => { if (result.consumedAnswers.has(index)) consumed.add(answer.rowId); });
    records.forEach((record, index) => { if (result.consumedRecords.has(index)) for (const id of record.rowIds) consumed.add(id); });
    if (!result.changed) continue;
    // Shown on 总览 / 网申资料 until closed (two renders of a page must not lose it).
    const ids = new Set(result.learned.map((item) => item.id));
    for (const entry of result.profile.learned) if (ids.has(entry.id)) { entry.seen = false; entry.captureKey = entry.captureKey || "backlog"; }
    profile = result.profile;
    if (result.preferredCities !== undefined) preferredCities = result.preferredCities;
    learned.push(...result.learned);
    changed = true;
  }
  if (changed) await tx.user.update({ where: { id: userId }, data: { applicationProfile: profile as Prisma.InputJsonValue, preferredCities } });
  if (consumed.size) await tx.pendingApplicationChange.updateMany({ where: { id: { in: [...consumed] }, status: "pending" }, data: { status: "accepted", revision: { increment: 1 } } });
  return learned;
}
