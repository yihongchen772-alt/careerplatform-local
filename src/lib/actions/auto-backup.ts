"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { cloudFolderSuggestions, prepareFolder, runAutoBackup, testWebdav, type AutoBackupOutcome } from "@/lib/auto-backup";

export type AutoBackupSettings = {
  enabled: boolean;
  intervalHours: number;
  keep: number;
  folder: string | null;
  webdavUrl: string | null;
  webdavUser: string | null;
  hasWebdavPassword: boolean;
  lastAt: string | null;
  lastError: string | null;
  suggestions: { label: string; path: string }[];
};

const settingsSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.coerce.number().int().refine((n) => [6, 12, 24, 72, 168].includes(n), "备份频率不支持"),
  keep: z.coerce.number().int().min(1, "至少保留 1 份").max(60, "最多保留 60 份"),
  folder: z.string().trim().max(1000).nullish(),
  webdavUrl: z.string().trim().max(1000).nullish(),
  webdavUser: z.string().trim().max(200).nullish(),
  /** Empty keeps the saved password; `clearWebdav` removes all WebDAV settings. */
  webdavPassword: z.string().max(500).nullish(),
  clearWebdav: z.boolean().optional(),
});

export async function getAutoBackupSettings(): Promise<AutoBackupSettings> {
  const user = await requireUser();
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  return {
    enabled: row.autoBackupEnabled,
    intervalHours: row.autoBackupIntervalHours,
    keep: row.autoBackupKeep,
    folder: row.autoBackupDir,
    webdavUrl: row.webdavUrl,
    webdavUser: row.webdavUser,
    hasWebdavPassword: !!row.webdavPasswordEncrypted,
    lastAt: row.autoBackupLastAt?.toISOString() ?? null,
    lastError: row.autoBackupLastError,
    suggestions: await cloudFolderSuggestions(),
  };
}

export async function saveAutoBackupSettings(input: unknown): Promise<ActionResult<AutoBackupSettings>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const data = settingsSchema.parse(input);
    const folder = data.folder || null;
    if (folder) await prepareFolder(folder).catch((err: Error) => { throw new UserFacingError(err.message); });
    const current = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { webdavPasswordEncrypted: true } });
    const webdavUrl = data.clearWebdav ? null : data.webdavUrl || null;
    if (webdavUrl) {
      let url;
      try { url = new URL(webdavUrl); } catch { throw new UserFacingError("WebDAV 地址格式不正确"); }
      if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new UserFacingError("WebDAV 请使用不含账号、查询或片段的 HTTPS 地址");
    }
    const webdavPasswordEncrypted = data.clearWebdav ? null : data.webdavPassword ? encryptSecret(data.webdavPassword) : current.webdavPasswordEncrypted;
    if (webdavUrl && (!data.webdavUser || !webdavPasswordEncrypted)) throw new UserFacingError("WebDAV 需要账号和应用密码");
    if (data.enabled && !folder && !webdavUrl) throw new UserFacingError("开启自动备份前，先选一个备份文件夹或填写 WebDAV");
    await db.user.update({
      where: { id: user.id },
      data: {
        autoBackupEnabled: data.enabled,
        autoBackupIntervalHours: data.intervalHours,
        autoBackupKeep: data.keep,
        autoBackupDir: folder,
        webdavUrl,
        webdavUser: data.clearWebdav ? null : data.webdavUser || null,
        webdavPasswordEncrypted,
        autoBackupLastError: null,
      },
    });
    revalidatePath("/settings");
    return getAutoBackupSettings();
  });
}

export async function testWebdavConnection(input: { url: string; user: string; password?: string }): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    let password = input.password;
    if (!password) {
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { webdavPasswordEncrypted: true } });
      if (!row.webdavPasswordEncrypted) throw new UserFacingError("填写应用密码后再测试");
      password = decryptSecret(row.webdavPasswordEncrypted);
    }
    try {
      await testWebdav({ url: input.url, user: input.user, password });
    } catch (err) {
      throw new UserFacingError(err instanceof Error ? (err.name === "TimeoutError" ? "连接超时" : err.message) : "连接失败");
    }
    return null;
  });
}

export async function runAutoBackupNow(): Promise<ActionResult<AutoBackupOutcome>> {
  return toActionResult(async () => {
    await requireUser();
    const outcome = await runAutoBackup({ force: true });
    if (outcome.error) throw new UserFacingError(outcome.error);
    revalidatePath("/settings");
    return outcome;
  });
}
