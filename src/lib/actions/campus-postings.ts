"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { readFeishuBase } from "@/lib/render-bridge-client";
import { mapSheetRow, samePosting, type PostingFields } from "@/lib/campus-sheet";
import { resolveCompanyId } from "@/lib/company-resolver";
import { computeInterestScore } from "@/lib/scoring";

/** A synced sheet older than this is synced again when the page is opened. */
const STALE_MS = 12 * 3600_000;
const FEISHU_BASE = /^https:\/\/[a-z0-9-]+\.(?:feishu\.cn|larksuite\.com)\/(?:share\/)?base\/[A-Za-z0-9]+/i;

export type SyncSummary = { added: number; updated: number; removed: number; total: number; name: string | null };

/** The link as pasted, trimmed to the share address (people paste it with surrounding text). */
function cleanLink(raw: string): string {
  const link = raw.trim().match(/https:\/\/\S+/)?.[0]?.replace(/[，。,）)】」]+$/, "") ?? "";
  if (!FEISHU_BASE.test(link)) throw new UserFacingError("请粘贴完整的飞书多维表格链接（https://….feishu.cn/base/…）");
  return link;
}

/** Subscribes to a 校招信息表 by its 飞书 link and syncs it once straight away. */
export async function savePostingSource(rawUrl: string): Promise<ActionResult<SyncSummary>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const url = cleanLink(String(rawUrl ?? ""));
    const existing = await db.postingSource.findFirst({ where: { userId: user.id, url } });
    const source = existing ?? (await db.postingSource.create({ data: { userId: user.id, url } }));
    return syncSource(user.id, source.id);
  });
}

export async function syncPostingSource(sourceId: string): Promise<ActionResult<SyncSummary>> {
  return toActionResult(async () => {
    const user = await requireUser();
    return syncSource(user.id, String(sourceId ?? ""));
  });
}

/** Syncs every subscribed sheet not synced in the last 12 hours (opening the page). */
export async function syncStalePostingSources(): Promise<ActionResult<SyncSummary | null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const stale = await db.postingSource.findFirst({
      where: { userId: user.id, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - STALE_MS) } }] },
      orderBy: { lastSyncedAt: "asc" },
    });
    return stale ? syncSource(user.id, stale.id) : null;
  });
}

export async function removePostingSource(sourceId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.postingSource.deleteMany({ where: { id: String(sourceId ?? ""), userId: user.id } });
    revalidatePath("/leads");
    return null;
  });
}

const running = new Set<string>();

/**
 * Reads the whole sheet, then writes only what changed: new rows are added,
 * changed rows updated, rows gone from the sheet removed (unless already
 * added to the 候选岗位池, which keeps them). A failed read leaves the stored
 * rows as they were and records the reason.
 */
async function syncSource(userId: string, sourceId: string): Promise<SyncSummary> {
  const source = await db.postingSource.findFirst({ where: { id: sourceId, userId } });
  if (!source) throw new UserFacingError("没找到这个订阅，请刷新后重试");
  if (running.has(source.id)) throw new UserFacingError("正在同步，请稍候");
  running.add(source.id);
  try {
    let sheet;
    try {
      sheet = await readFeishuBase(source.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取失败";
      await db.postingSource.update({ where: { id: source.id }, data: { lastError: message.slice(0, 300) } });
      throw new UserFacingError(`飞书表格没读到：${message}`);
    }
    const now = new Date();
    const rows = new Map<string, PostingFields>();
    for (const row of sheet.rows) {
      const fields = mapSheetRow(row, now);
      if (fields) rows.set(fields.externalId, fields);
    }
    if (!rows.size) throw new UserFacingError("这个表格里没认出公司列，确认是校招信息表的链接");

    const stored = await db.campusPosting.findMany({ where: { sourceId: source.id } });
    const byExternal = new Map(stored.map((row) => [row.externalId, row]));
    const toCreate: PostingFields[] = [];
    const toUpdate: { id: string; data: Omit<PostingFields, "externalId"> }[] = [];
    for (const fields of rows.values()) {
      const old = byExternal.get(fields.externalId);
      const { externalId, ...data } = fields;
      void externalId;
      if (!old) toCreate.push(fields);
      else if (!samePosting(data, old)) toUpdate.push({ id: old.id, data });
    }
    const gone = stored.filter((row) => !rows.has(row.externalId) && !row.positionId).map((row) => row.id);

    for (let at = 0; at < toCreate.length; at += 500) {
      await db.campusPosting.createMany({ data: toCreate.slice(at, at + 500).map((fields) => ({ ...fields, userId, sourceId: source.id, firstSeenAt: now })) });
    }
    for (let at = 0; at < toUpdate.length; at += 200) {
      await db.$transaction(toUpdate.slice(at, at + 200).map(({ id, data }) => db.campusPosting.update({ where: { id }, data })));
    }
    for (let at = 0; at < gone.length; at += 500) {
      await db.campusPosting.deleteMany({ where: { id: { in: gone.slice(at, at + 500) } } });
    }
    const total = await db.campusPosting.count({ where: { sourceId: source.id } });
    await db.postingSource.update({ where: { id: source.id }, data: { lastSyncedAt: now, lastError: null, total, name: sheet.name?.slice(0, 120) || source.name } });
    revalidatePath("/leads");
    return { added: toCreate.length, updated: toUpdate.length, removed: gone.length, total, name: sheet.name || null };
  } finally {
    running.delete(source.id);
  }
}

/**
 * 「加入」: the posting becomes a 候选岗位 (the 待投递 list). One posting is
 * usually a company's whole 校招 with several 岗位方向, so the title says
 * which 招聘 it is and the directions go into the notes.
 */
export async function addPostingToPool(postingId: string): Promise<ActionResult<{ positionId: string; existed: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const posting = await db.campusPosting.findFirst({ where: { id: String(postingId ?? ""), userId: user.id } });
    if (!posting) throw new UserFacingError("没找到这条招聘信息，请刷新后重试");
    if (posting.positionId && (await db.position.findFirst({ where: { id: posting.positionId, userId: user.id }, select: { id: true } }))) {
      return { positionId: posting.positionId, existed: true };
    }
    const companyId = await resolveCompanyId(posting.company, { aiUserId: user.id, addedByUserId: user.id });
    const title = postingTitle(posting);
    const existing = await db.position.findFirst({ where: { userId: user.id, companyId, OR: [{ title }, ...(posting.applyUrl ? [{ jdUrl: posting.applyUrl }] : [])] }, select: { id: true } });
    const position = existing ?? (await db.position.create({
      data: {
        userId: user.id,
        companyId,
        title,
        track: posting.industry ?? undefined,
        location: posting.cities ?? undefined,
        deadline: posting.deadline ?? undefined,
        source: "校招信息表",
        jdUrl: posting.applyUrl ?? undefined,
        jdText: [posting.roles ? `岗位方向：${posting.roles}` : "", posting.degree ? `学历：${posting.degree}` : "", posting.writtenTest ? `笔试：${posting.writtenTest}` : "", posting.deadlineText ? `截止：${posting.deadlineText}` : "", posting.note ?? "", posting.noticeUrl ? `公告：${posting.noticeUrl}` : ""].filter(Boolean).join("\n") || undefined,
        status: "EVALUATING",
        interestScore: computeInterestScore(undefined),
      },
      select: { id: true },
    }));
    await db.campusPosting.update({ where: { id: posting.id }, data: { positionId: position.id } });
    revalidatePath("/leads");
    revalidatePath("/pool");
    return { positionId: position.id, existed: !!existing };
  });
}

/** "2027届秋招" — or the one 岗位 when the row names just one short role. */
function postingTitle(posting: { roles: string | null; cohort: string | null; kind: string | null }): string {
  const roles = (posting.roles ?? "").split(/[\n、,，;；]+/).map((role) => role.trim()).filter(Boolean);
  if (roles.length === 1 && roles[0].length <= 30) return roles[0];
  const kind = (posting.kind ?? "校招").split("、")[0];
  const cohort = posting.cohort?.split("、").find((item) => /^\d{4}届$/.test(item)) ?? "";
  return `${cohort}${kind}`.slice(0, 60) || "校园招聘";
}
