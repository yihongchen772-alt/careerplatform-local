import path from "path";
import { readdir, readFile } from "fs/promises";
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
    return { payload, files: Object.keys(files).length };
}

