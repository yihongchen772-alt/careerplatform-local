"use server";

import os from "os";
import path from "path";
import { mkdir, writeFile, readdir, readFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

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
  "aiKey",
  "company",
  "resumeVersion",
  "position",
  "application",
  "stageHistory",
  "attachment",
  "interviewPrep",
  "interviewQA",
  "personalTask",
  "interviewSession",
  "interviewMessage",
  "personalityTestResult",
  "careerFitAnalysis",
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
  aiKey: [["userId", "user"]],
  company: [["addedByUserId", "user"]],
  resumeVersion: [["userId", "user"]],
  position: [["userId", "user"], ["companyId", "company"]],
  application: [
    ["userId", "user"],
    ["companyId", "company"],
    ["positionId", "position"],
    ["resumeVersionId", "resumeVersion"],
  ],
  stageHistory: [["applicationId", "application"]],
  attachment: [
    ["userId", "user"],
    ["applicationId", "application"],
    ["stageHistoryId", "stageHistory"],
  ],
  interviewPrep: [["userId", "user"], ["positionId", "position"]],
  interviewQA: [["userId", "user"], ["applicationId", "application"]],
  personalTask: [
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
};

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
    await requireUser();

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
  position: "候选岗位",
  application: "投递记录",
  resumeVersion: "简历版本",
  personalTask: "日程待办",
  interviewSession: "模拟面试",
  company: "企业",
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

/** Destructive: wipes current data and restores the backup wholesale. */
export async function importBackup(
  json: string
): Promise<ActionResult<{ restored: number; skipped: number }>> {
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
      const rows = (data[table] ?? []) as Record<string, unknown>[];
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

    for (const p of ["/dashboard", "/pool", "/applications", "/resumes", "/settings", "/companies"]) {
      revalidatePath(p);
    }
    return { restored, skipped };
  });
}
