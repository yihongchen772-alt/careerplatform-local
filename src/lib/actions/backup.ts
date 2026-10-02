"use server";

import os from "os";
import path from "path";
import { statSync } from "fs";
import { randomUUID } from "crypto";
import { mkdir, writeFile, mkdtemp, open, readFile, rm } from "fs/promises";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, LOCAL_USER_ID } from "@/lib/session";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { mimeTypeForExtension } from "@/lib/local-storage";
import { parseBackup } from "@/lib/backup-validation";
import { fetchBackupFile } from "@/lib/fetch-backup-file";
import { FILE_FIELDS, MAX_BACKUP_BYTES, referencedBackupFiles, storedBackupFilename } from "@/lib/backup-files";
import { TABLES, buildBackupPayload, uploadsDir, type Delegate, type TableName } from "@/lib/backup-core";

/** Where a backup lands. Downloads exists on both macOS and Windows; fall back to userData. */
async function backupTargetDir(): Promise<string> {
  const downloads = path.join(os.homedir(), "Downloads");
  try {
    await mkdir(downloads, { recursive: true });
    return downloads;
  } catch {
    const fallback = path.join(uploadsDir(), "..", "backups");
    await mkdir(fallback, { recursive: true });
    return fallback;
  }
}


/**
 * Foreign keys, as [field, parentTable]. Used to drop rows whose parent is
 * missing before writing anything, so one bad row can't abort the whole
 * restore. This matters in practice: a row orphaned by any past raw-SQL
 * delete (SQLite doesn't enforce FKs unless the pragma is on) used to make
 * `create()` throw mid-transaction and roll back an otherwise fine backup,
 * leaving the user with nothing restored. Nullable FKs are handled by the
 * null check in isRowValid, not listed separately.
 */
const FOREIGN_KEYS: Partial<Record<TableName, [field: string, parent: TableName][]>> = {
  desktopNote: [["userId", "user"]],
  calendarEvent: [["userId", "user"], ["noteId", "desktopNote"]],
  eventReminder: [["eventId", "calendarEvent"]],
  dailyDigest: [["userId", "user"]],
  weeklyReview: [["userId", "user"]],
  resumeComparisonSummary: [["userId", "user"]],
  interviewIntelligence: [["userId", "user"]],
  aiKey: [["userId", "user"]],
  mailAccount: [["userId", "user"]],
  company: [["addedByUserId", "user"]],
  companyAlias: [["companyId", "company"]],
  radarJobPosting: [["companyId", "company"]],
  radarJobEvent: [["companyId", "company"]],
  jobLead: [["userId", "user"]],
  resumeVersion: [["userId", "user"]],
  position: [["userId", "user"], ["companyId", "company"]],
  application: [
    ["userId", "user"],
    ["companyId", "company"],
    ["positionId", "position"],
    ["portalId", "applicationPortal"],
    ["resumeVersionId", "resumeVersion"],
  ],
  stageHistory: [["applicationId", "application"]],
  interviewNoteExtract: [["userId", "user"], ["stageHistoryId", "stageHistory"]],
  stagePostmortem: [["userId", "user"], ["stageHistoryId", "stageHistory"]],
  attachment: [
    ["userId", "user"],
    ["applicationId", "application"],
    ["stageHistoryId", "stageHistory"],
  ],
  positionMatch: [["userId", "user"], ["positionId", "position"], ["resumeVersionId", "resumeVersion"]],
  resumeTailoring: [["userId", "user"], ["positionId", "position"], ["resumeVersionId", "resumeVersion"]],
  resumeDrill: [["userId", "user"], ["resumeVersionId", "resumeVersion"], ["positionId", "position"]],
  skillGapAnalysis: [["userId", "user"], ["resumeVersionId", "resumeVersion"]],
  autofillAnswer: [["userId", "user"], ["resumeVersionId", "resumeVersion"]],
  applicationPortal: [["companyId", "company"]],
  interviewPrep: [["userId", "user"], ["positionId", "position"]],
  groupInterviewPrep: [["userId", "user"], ["positionId", "position"]],
  coverLetter: [["userId", "user"], ["positionId", "position"]],
  interviewQA: [["userId", "user"], ["applicationId", "application"]],
  personalTask: [
    ["userId", "user"],
    ["positionId", "position"],
    ["applicationId", "application"],
  ],
  contact: [
    ["userId", "user"],
    ["positionId", "position"],
    ["applicationId", "application"],
  ],
  interviewSession: [
    ["userId", "user"],
    ["resumeVersionId", "resumeVersion"],
    ["positionId", "position"],
  ],
  interviewMessage: [["sessionId", "interviewSession"]],
  personalityTestResult: [["userId", "user"]],
  careerFitAnalysis: [["userId", "user"]],
  questionBank: [["userId", "user"]],
  examSession: [["userId", "user"]],
};

/**
 * This build has exactly one user, always id `LOCAL_USER_ID` — but a backup
 * being restored here isn't necessarily this app's own export. It might come
 * from the web version (multi-user, real cuid ids), where "导出我的数据"
 * produces a file in this same shape so a web account's data can move onto
 * this desktop build. Every row in a foreign backup carries that web
 * account's real id, which matches nothing here, so every userId (and the
 * `user` row's own id) gets forced onto LOCAL_USER_ID before anything else
 * runs. This is a no-op for this app's own exports, which already only ever
 * contain LOCAL_USER_ID.
 */
function remapToLocalUser(
  table: TableName,
  row: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...row };
  if (table === "eventReminder") { copy.claimToken = null; copy.claimUntil = null; }
  if (table === "user") {
    copy.id = LOCAL_USER_ID;
    copy.emailReminderClaimUntil = null;
  } else if ("userId" in copy) {
    copy.userId = LOCAL_USER_ID;
  }
  if (table === "company" && copy.addedByUserId != null) {
    copy.addedByUserId = LOCAL_USER_ID;
  }
  return copy;
}

function isRowValid(
  table: TableName,
  row: Record<string, unknown>,
  idsByTable: Map<TableName, Set<string>>
): boolean {
  for (const [field, parent] of FOREIGN_KEYS[table] ?? []) {
    const value = row[field];
    // A null FK is a legitimately absent optional relation, not a dangling one.
    if (value == null) continue;
    if (!idsByTable.get(parent)?.has(String(value))) return false;
  }
  return true;
}
// Prisma's per-model delegates all expose findMany/createMany/deleteMany, but
// their argument types differ per model; this app only ever passes plain rows
// through, so a loose shape here avoids 15 near-identical generic signatures.
export type BackupResult = { path: string; sizeMb: string; files: number };

export async function exportBackup(): Promise<ActionResult<BackupResult>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const { payload, files } = await buildBackupPayload();

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const target = path.join(await backupTargetDir(), `求职罗盘备份-${stamp}.json`);
    await writeFile(target, payload, "utf8");

    await db.user.update({ where: { id: user.id }, data: { lastBackupAt: new Date() } });
    revalidatePath("/settings");

    return {
      path: target,
      sizeMb: (Buffer.byteLength(payload) / 1024 / 1024).toFixed(1),
      files,
    };
  });
}

export type ImportPreview = {
  exportedAt: string;
  counts: { label: string; n: number }[];
  files: number;
};

const COUNT_LABELS: Partial<Record<TableName, string>> = {
  desktopNote: "便利贴",
  calendarEvent: "日历事项",
  eventReminder: "事项提醒",
  dailyDigest: "每日摘要",
  weeklyReview: "每周复盘",
  resumeComparisonSummary: "简历对比总结",
  interviewIntelligence: "面试能力总结",
  position: "候选岗位",
  application: "投递记录",
  resumeVersion: "简历版本",
  resumeDrill: "简历深挖",
  resumeTailoring: "简历定制",
  positionMatch: "岗位匹配",
  skillGapAnalysis: "技能差距分析",
  autofillAnswer: "网申回答",
  applicationPortal: "网申进度页",
  personalTask: "日程待办",
  contact: "联系人",
  interviewSession: "模拟面试",
  interviewMessage: "模拟面试消息",
  interviewPrep: "面试准备",
  groupInterviewPrep: "群面准备",
  coverLetter: "求职信",
  interviewQA: "面试题库",
  interviewNoteExtract: "面经提取",
  stagePostmortem: "面试复盘",
  stageHistory: "阶段历史",
  attachment: "附件",
  company: "企业",
  companyAlias: "企业别名",
  radarJobPosting: "岗位雷达职位",
  radarJobEvent: "岗位雷达事件",
  jobLead: "秋招信息库线索",
  questionBank: "题库",
  mailAccount: "收件箱扫描邮箱",
  aiKey: "AI Key",
  personalityTestResult: "性格测评结果",
  careerFitAnalysis: "职业匹配分析",
  examSession: "模拟考试",
};

/** Read-only: parses and summarises a backup so the user can see what they're about to overwrite. */
export async function previewBackup(json: string): Promise<ActionResult<ImportPreview>> {
  return toActionResult(async () => {
    await requireUser();
    const { data, files, exportedAt } = parseBackup(json);
    const counts = (Object.entries(COUNT_LABELS) as [TableName, string][])
      .map(([table, label]) => ({ label, n: data[table]?.length ?? 0 }))
      .filter((c) => c.n > 0);
    return { exportedAt, counts, files: Object.keys(files).length };
  });
}

/** Destructive: wipes current data and restores the backup wholesale. */
export async function importBackup(
  json: string
): Promise<ActionResult<{ restored: number; skipped: number; filesMigrated: number; filesFailed: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const { data, files } = parseBackup(json);

    // Resolve which rows are actually restorable *before* touching anything,
    // walking parents-first so each table validates against the parents that
    // survived rather than against the raw backup.
    const idsByTable = new Map<TableName, Set<string>>();
    const cleaned = new Map<TableName, Record<string, unknown>[]>();
    let skipped = 0;
    for (const table of TABLES) {
      const rows = ((data[table] ?? []) as Record<string, unknown>[]).map((row) =>
        remapToLocalUser(table, row)
      );
      const keep = rows.filter((row) => isRowValid(table, row, idsByTable));
      skipped += rows.length - keep.length;
      cleaned.set(table, keep);
      idsByTable.set(table, new Set(keep.map((r) => String(r.id))));
    }

    // Allocate fresh immutable names. Old attachments are never overwritten,
    // even if SQLite rejects a row or the process crashes before commit.
    await mkdir(uploadsDir(), { recursive: true });
    const staging = await mkdtemp(path.join(uploadsDir(), ".restore-"));
    const promoted: string[] = [];
    const replacements = new Map<string, string>();
    let committed = false;
    let filesMigrated = 0;
    let filesFailed = 0;
    let restored = 0;
    const usedFiles = referencedBackupFiles(Object.fromEntries(cleaned));
    let fileBytes = [...usedFiles].reduce((sum, name) => sum + Buffer.byteLength(files[name], "base64"), 0);
    const downloadDeadline = AbortSignal.timeout(120000);
    try {
      for (const [name, b64] of Object.entries(files)) {
        if (!usedFiles.has(name)) continue;
        const fresh = `${randomUUID()}${path.extname(name)}`;
        await writeFile(path.join(staging, fresh), Buffer.from(b64, "base64"), { flag: "wx" });
        replacements.set(name, fresh);
      }
      for (const [table, field] of Object.entries(FILE_FIELDS) as [TableName, string][]) {
        for (const row of cleaned.get(table) ?? []) {
          const value = row[field];
          const local = storedBackupFilename(value);
          if (local) { row[field] = `/api/files/${replacements.get(local)}`; continue; }
          if (typeof value !== "string" || !/^https?:\/\//i.test(value)) continue;
          try {
            const remaining = MAX_BACKUP_BYTES * 0.75 - fileBytes;
            if (remaining <= 0) throw new Error("附件总大小超出限制");
            const { buffer, mimeType } = await fetchBackupFile(value, { signal: downloadDeadline, maxBytes: remaining });
            fileBytes += buffer.length;
            const ext = [".pdf", ".png", ".jpg", ".webp", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".txt", ".md"].find((e) => mimeTypeForExtension(e) === mimeType);
            if (!ext) throw new Error("不支持的附件类型");
            const fresh = `${randomUUID()}${ext}`;
            await writeFile(path.join(staging, fresh), buffer, { flag: "wx" });
            replacements.set(fresh, fresh);
            row[field] = `/api/files/${fresh}`;
            filesMigrated++;
          } catch { filesFailed++; }
        }
      }
      for (const fresh of new Set(replacements.values())) {
        const target = path.join(uploadsDir(), fresh);
        const handle = await open(target, "wx");
        promoted.push(target);
        try { await handle.writeFile(await readFile(path.join(staging, fresh))); }
        finally { await handle.close(); }
      }
      await db.$transaction(async (tx) => {
        const txDelegate = (t: TableName) => (tx as unknown as Record<TableName, Delegate>)[t];
        // Children first so foreign keys never dangle mid-wipe.
        for (const table of [...TABLES].reverse()) {
          await txDelegate(table).deleteMany();
        }
        for (const table of TABLES) {
          for (const row of cleaned.get(table) ?? []) {
            await txDelegate(table).create({ data: row });
            restored++;
          }
        }
        // Backups made before ApplicationPortal existed only carry the legacy
        // Company.portalUrl columns. Materialize those after restore so an old
        // backup does not silently lose all configured progress syncing.
        const restoredPortals = cleaned.get("applicationPortal") ?? [];
        for (const company of cleaned.get("company") ?? []) {
          const url = typeof company.portalUrl === "string" ? company.portalUrl : null;
          if (!url || restoredPortals.some((p) => p.companyId === company.id && p.url === url)) continue;
          await tx.applicationPortal.create({
            data: {
              id: `portal_${company.id}`,
              companyId: String(company.id),
              url,
              contentHash: typeof company.portalContentHash === "string" ? company.portalContentHash : null,
              lastCheckedAt: typeof company.portalLastCheckedAt === "string" ? new Date(company.portalLastCheckedAt) : null,
              lastError: typeof company.portalLastError === "string" ? company.portalLastError : null,
            },
          });
          restored++;
        }
      }, { timeout: 30000 });
      committed = true;
    } finally {
      if (!committed) await Promise.all(promoted.map((file) => rm(file, { force: true })));
      await rm(staging, { recursive: true, force: true }).catch((err) => console.error("[restore] staging cleanup failed", err));
    }

    for (const p of [
      "/dashboard",
      "/pool",
      "/applications",
      "/resumes",
      "/settings",
      "/companies",
      "/contacts",
      "/leads",
      "/question-banks",
      "/calendar",
    ]) {
      revalidatePath(p);
    }
    return { restored, skipped, filesMigrated, filesFailed };
  });
}

/**
 * A DATABASE_URL of "file:./local.db" (dev) or an absolute path (packaged —
 * see electron/main.js, which points it at userData/local.db) is all Prisma
 * itself understands here; nothing else in the app has parsed it back out
 * to a real filesystem path before, so this is duplicated rather than
 * reused from anywhere.
 *
 * A relative path is resolved against prisma/schema.prisma's own directory,
 * NOT process.cwd() — that's Prisma's documented SQLite behavior, and dev's
 * .env sets exactly this ("file:./local.db"), resolving to prisma/local.db.
 * Getting this wrong silently reads a different, empty local.db that
 * happens to also exist at the project root — caught by actually checking
 * the file this pointed at rather than assuming cwd was right.
 */
function resolveDbPath(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) return null;
  const raw = url.slice("file:".length);
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), "prisma", raw);
}

export type DataFreshness = { dbUpdatedAt: string | null; lastBackupAt: string | null };

/**
 * There's no cloud sync in this build — running the app on two machines
 * (e.g. this desktop's Mac and Windows installs) means two completely
 * independent local databases that only ever converge through a manual
 * export/import. dbUpdatedAt (the SQLite file's own mtime — any write to
 * any table touches it, so it's a reliable proxy for "last time anything
 * changed here" without needing an updatedAt column on every model) plus
 * lastBackupAt together let the settings page answer "is this the machine
 * with my newest data, and have I backed it up recently" instead of the
 * user finding out only after the two copies have already diverged.
 */
export async function getDataFreshness(): Promise<ActionResult<DataFreshness>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const dbPath = resolveDbPath();
    let dbUpdatedAt: string | null = null;
    if (dbPath) {
      try {
        dbUpdatedAt = statSync(dbPath).mtime.toISOString();
      } catch {
        // Path didn't parse to a real file (unexpected DATABASE_URL shape) —
        // leave it null rather than fail the whole settings page over this.
      }
    }
    const row = await db.user.findUnique({ where: { id: user.id }, select: { lastBackupAt: true } });
    return { dbUpdatedAt, lastBackupAt: row?.lastBackupAt?.toISOString() ?? null };
  });
}
