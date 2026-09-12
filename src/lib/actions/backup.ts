"use server";

import os from "os";
import path from "path";
import { statSync } from "fs";
import { mkdir, writeFile, readdir, readFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, LOCAL_USER_ID } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { saveLocalFile, mimeTypeForExtension, ALLOWED_LIBRARY_MIME } from "@/lib/local-storage";

/**
 * Bumped whenever the export shape changes incompatibly. Import refuses a
 * file whose major version it doesn't understand rather than half-restoring
 * something and leaving the database in a mixed state.
 */
const BACKUP_VERSION = 1;

function uploadsDir(): string {
  return process.env.LOCAL_UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

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

// Order matters on import: parents before children, so foreign keys always
// resolve. Session/VerificationToken/Account are deliberately absent — this
// build has no login, so they're empty and restoring them means nothing.
const TABLES = [
  "user",
  "dailyDigest",
  "weeklyReview",
  "resumeComparisonSummary",
  "interviewIntelligence",
  "aiKey",
  "mailAccount",
  "company",
  "companyAlias",
  "radarJobPosting",
  "radarJobEvent",
  "jobLead",
  "resumeVersion",
  "position",
  "application",
  "stageHistory",
  "interviewNoteExtract",
  "stagePostmortem",
  "attachment",
  "positionMatch",
  "resumeTailoring",
  "resumeDrill",
  "skillGapAnalysis",
  "autofillAnswer",
  "interviewPrep",
  "groupInterviewPrep",
  "coverLetter",
  "interviewQA",
  "personalTask",
  "contact",
  "interviewSession",
  "interviewMessage",
  "personalityTestResult",
  "careerFitAnalysis",
  "questionBank",
  "examSession",
] as const;

type TableName = (typeof TABLES)[number];

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
  if (table === "user") {
    copy.id = LOCAL_USER_ID;
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
type Delegate = {
  findMany: (args?: unknown) => Promise<unknown[]>;
  create: (args: { data: unknown }) => Promise<unknown>;
  deleteMany: (args?: unknown) => Promise<unknown>;
};

function delegate(table: TableName): Delegate {
  return (db as unknown as Record<TableName, Delegate>)[table];
}

export type BackupResult = { path: string; sizeMb: string; files: number };

export async function exportBackup(): Promise<ActionResult<BackupResult>> {
  return toActionResult(async () => {
    const user = await requireUser();

    const data: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      data[table] = await delegate(table).findMany();
    }

    // Resume/attachment files live on disk, so a data-only dump would restore
    // rows pointing at files that no longer exist. Base64 inflates by ~33%,
    // which is fine at this scale (a handful of PDFs) and keeps a backup to
    // exactly one self-contained file with no zip dependency.
    const files: Record<string, string> = {};
    try {
      for (const name of await readdir(uploadsDir())) {
        if (name.startsWith(".")) continue;
        const buf = await readFile(path.join(uploadsDir(), name));
        files[name] = buf.toString("base64");
      }
    } catch {
      // No uploads directory yet — a backup with zero files is still valid.
    }

    const payload = JSON.stringify({
      backupVersion: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data,
      files,
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const target = path.join(await backupTargetDir(), `求职罗盘备份-${stamp}.json`);
    await writeFile(target, payload, "utf8");

    await db.user.update({ where: { id: user.id }, data: { lastBackupAt: new Date() } });
    revalidatePath("/settings");

    return {
      path: target,
      sizeMb: (Buffer.byteLength(payload) / 1024 / 1024).toFixed(1),
      files: Object.keys(files).length,
    };
  });
}

export type ImportPreview = {
  exportedAt: string;
  counts: { label: string; n: number }[];
  files: number;
};

const COUNT_LABELS: Partial<Record<TableName, string>> = {
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

function parseBackup(json: string): { data: Record<string, unknown[]>; files: Record<string, string>; exportedAt: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new UserFacingError("这个文件不是有效的备份文件（JSON 解析失败）");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj?.backupVersion !== "number") {
    throw new UserFacingError("这个文件不像是本 App 导出的备份");
  }
  if (obj.backupVersion !== BACKUP_VERSION) {
    throw new UserFacingError(
      `备份文件版本是 ${obj.backupVersion}，当前 App 只认识版本 ${BACKUP_VERSION}，没法安全恢复`
    );
  }
  return {
    data: (obj.data ?? {}) as Record<string, unknown[]>,
    files: (obj.files ?? {}) as Record<string, string>,
    exportedAt: String(obj.exportedAt ?? ""),
  };
}

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

/**
 * A backup coming from the web version's export carries `fileUrl`/`url`
 * pointing at its cloud blob storage, not a local file — this app only ever
 * reads resumes/attachments off disk (src/lib/local-storage.ts, used by
 * AI features like 简历体检/岗位匹配). Left as-is, "查看文件" still works fine
 * (it's a plain absolute-URL link), but anything that reads the file's
 * *content* would fail with "简历文件已丢失". Best-effort fetch it once at
 * import time and rewrite the field to the freshly-saved local copy; a
 * failure (offline, expired link, unrecognized file type) just leaves the
 * original URL in place rather than failing the whole restore — the row is
 * still useful (and still openable) without a local copy of its file.
 */
const REMOTE_FILE_FIELDS: Partial<Record<TableName, string>> = {
  resumeVersion: "fileUrl",
  attachment: "url",
};

async function migrateRemoteFile(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    let mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!ALLOWED_LIBRARY_MIME.includes(mimeType)) {
      mimeType = mimeTypeForExtension(path.extname(new URL(url).pathname)) ?? "";
    }
    if (!ALLOWED_LIBRARY_MIME.includes(mimeType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { url: localUrl } = await saveLocalFile(buf, mimeType);
    return localUrl;
  } catch {
    return null;
  }
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

    // Write files first: if this fails we haven't touched the database yet,
    // so the user still has their existing data intact.
    await mkdir(uploadsDir(), { recursive: true });
    for (const [name, b64] of Object.entries(files)) {
      if (name.includes("/") || name.includes("\\") || name.includes("..")) continue;
      await writeFile(path.join(uploadsDir(), name), Buffer.from(b64, "base64"));
    }

    // Sequential, not Promise.all: this only ever runs against a handful of
    // resumes/attachments, and hammering someone's blob storage with a burst
    // of concurrent requests during an import isn't worth the speedup.
    let filesMigrated = 0;
    let filesFailed = 0;
    for (const [table, field] of Object.entries(REMOTE_FILE_FIELDS) as [TableName, string][]) {
      for (const row of cleaned.get(table) ?? []) {
        const value = row[field];
        if (typeof value !== "string" || !/^https?:\/\//i.test(value)) continue;
        const migrated = await migrateRemoteFile(value);
        if (migrated) {
          row[field] = migrated;
          filesMigrated++;
        } else {
          filesFailed++;
        }
      }
    }

    let restored = 0;
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
    });

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
