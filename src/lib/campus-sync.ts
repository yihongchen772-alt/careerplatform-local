import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/action-result";
import { feishuBaseRevision, readFeishuBase } from "@/lib/render-bridge-client";
import { cohortLabel, mapSheetRow, samePosting, type PostingFields } from "@/lib/campus-sheet";

/**
 * Syncing a subscribed 校招信息表 — shared by the page's buttons (server
 * actions) and the background check the desktop app runs every hour
 * (/api/postings/check). Not a "use server" module: these take a userId.
 */

export type SyncSummary = {
  added: number; updated: number; removed: number; total: number; name: string | null;
  /** Rows the sheet's owner added since the first sync; of them, for the user's 届次 and still open; of those, closing within 7 days. */
  fresh: number; freshMine: number; freshClosing: number;
};

function forCohort(cohort: string | null, graduationYear: number | null): boolean {
  const label = cohortLabel(graduationYear);
  return !label || !cohort || cohort.includes(label);
}

const running = new Set<string>();

/**
 * Reads the whole sheet, then writes only what changed: new rows are added,
 * changed rows updated, rows gone from the sheet removed (unless already
 * added to the 候选岗位池, which keeps them). A failed read leaves the stored
 * rows as they were and records the reason.
 */
export async function syncSource(userId: string, sourceId: string): Promise<SyncSummary> {
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
    const graduationYear = (await db.user.findUnique({ where: { id: userId }, select: { graduationYear: true } }))?.graduationYear ?? null;
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
    await db.postingSource.update({ where: { id: source.id }, data: { lastSyncedAt: now, lastCheckedAt: now, firstSyncedAt: source.firstSyncedAt ?? now, rev: typeof sheet.rev === "number" ? sheet.rev : null, lastError: null, total, name: sheet.name?.slice(0, 120) || source.name } });
    revalidatePath("/leads");
    // What the owner added since the first sync, as a notification would put it.
    const fresh = source.firstSyncedAt ? toCreate : [];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mine = fresh.filter((row) => forCohort(row.cohort, graduationYear) && (!row.deadline || row.deadline >= today));
    const closing = mine.filter((row) => row.deadline && row.deadline.getTime() < today.getTime() + 8 * 86400_000).length;
    return { added: toCreate.length, updated: toUpdate.length, removed: gone.length, total, name: sheet.name || null, fresh: fresh.length, freshMine: mine.length, freshClosing: closing };
  } finally {
    running.delete(source.id);
  }
}


/**
 * The background check: each sheet's revision is asked with one small
 * request, and only a sheet that changed (or can't be told that way, e.g.
 * just after launch) is read in full.
 */
export async function checkPostingSources(userId: string, staleBefore?: Date): Promise<{ synced: SyncSummary[]; checked: number; errors: string[] }> {
  const sources = await db.postingSource.findMany({ where: { userId } });
  const synced: SyncSummary[] = [];
  const errors: string[] = [];
  let checked = 0;
  for (const source of sources) {
    // Opening the page only looks again at a sheet nobody has looked at for a while.
    const lastLook = source.lastCheckedAt ?? source.lastSyncedAt;
    if (staleBefore && lastLook && lastLook >= staleBefore) continue;
    checked += 1;
    const rev = source.rev == null ? null : await feishuBaseRevision(source.url);
    if (rev != null && rev === source.rev) {
      await db.postingSource.update({ where: { id: source.id }, data: { lastCheckedAt: new Date() } });
      continue;
    }
    try {
      synced.push(await syncSource(userId, source.id));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "同步失败");
    }
  }
  return { synced, checked, errors };
}
