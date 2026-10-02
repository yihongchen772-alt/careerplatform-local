import path from "path";
import { readdir, open } from "fs/promises";
import { constants, type Dirent } from "fs";
import { referencedBackupFiles, validBackupFilename, MAX_BACKUP_FILE_BYTES, MAX_BACKUP_BYTES } from "@/lib/backup-files";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";

// Plain module, deliberately not "use server": everything here is used by the
// backup actions and the scheduled 自动备份, and must never itself be callable
// from the client (buildBackupPayload returns the entire database).

/**
 * Bumped whenever the export shape changes incompatibly. Import refuses a
 * file whose major version it doesn't understand rather than half-restoring
 * something and leaving the database in a mixed state.
 */
export const BACKUP_VERSION = 1;

export function uploadsDir(): string {
  return process.env.LOCAL_UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

// Order matters on import: parents before children, so foreign keys always
// resolve. Session/VerificationToken/Account are deliberately absent — this
// build has no login, so they're empty and restoring them means nothing.
export const TABLES = [
  "user",
  "dailyDigest",
  "weeklyReview",
  "resumeComparisonSummary",
  "interviewIntelligence",
  "aiKey",
  "mailAccount",
  "company",
  "companyAlias",
  "applicationPortal",
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
  "desktopNote",
  "calendarEvent",
  "eventReminder",
] as const;

export type TableName = (typeof TABLES)[number];

export type Delegate = {
  findMany: (args?: unknown) => Promise<unknown[]>;
  create: (args: { data: unknown }) => Promise<unknown>;
  deleteMany: (args?: unknown) => Promise<unknown>;
};

export function delegate(table: TableName): Delegate {
  return (db as unknown as Record<TableName, Delegate>)[table];
}

/**
 * The whole backup as one self-contained JSON string — shared by the manual
 * export below and the scheduled 自动备份 (src/lib/auto-backup.ts).
 */
export async function buildBackupPayload(): Promise<{ payload: string; files: number }> {
  // One SQLite read transaction pins a consistent view across all tables.
  const data = await db.$transaction(async (tx) => {
    const snapshot: Record<string, unknown[]> = {};
    for (const table of TABLES) snapshot[table] = await (tx as unknown as Record<TableName, Delegate>)[table].findMany();
    return snapshot;
  }, { timeout: 30000 });
  const required = referencedBackupFiles(data);
  const files: Record<string, string> = Object.create(null);
  let entries: Dirent[];
  try { entries = await readdir(uploadsDir(), { withFileTypes: true }); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new UserFacingError("无法读取附件目录，备份未完成");
    entries = [];
  }
  let size = 0;
  for (const entry of entries) {
    // Retained originals from successful restores are intentionally not part
    // of the current database; exporting only references prevents growth.
    if (!required.has(entry.name) || entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (!validBackupFilename(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new UserFacingError(`附件 ${entry.name} 是符号链接，备份未完成`);
    const file = await open(path.join(uploadsDir(), entry.name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BACKUP_FILE_BYTES) throw new UserFacingError(`附件 ${entry.name} 不是普通文件或超过 50MB`);
      const buf = await file.readFile();
      if (buf.length !== stat.size || (size += buf.length) > MAX_BACKUP_BYTES * 0.75) throw new UserFacingError("附件读取不完整或总计超过 192MB，备份未完成");
      files[entry.name] = buf.toString("base64");
    } finally { await file.close(); }
  }
  for (const name of required) if (!(name in files)) throw new UserFacingError(`附件 ${name} 已丢失，备份未完成，请重新上传或删除对应记录`);
  const payload = JSON.stringify({ backupVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(), data, files });
  if (Buffer.byteLength(payload) > MAX_BACKUP_BYTES) throw new UserFacingError("备份超过 256MB，请减少附件后重试");
  return { payload, files: Object.keys(files).length };
}
