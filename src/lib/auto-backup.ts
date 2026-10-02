import path from "path";
import os from "os";
import { access, mkdir, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { constants as fsConstants } from "fs";
import { db } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { buildBackupPayload } from "@/lib/backup-core";

// Plain module (not "use server"): the scheduled 自动备份 behind
// /api/backup-schedule/run and the settings card's 立即备份. The backup is the same
// self-contained JSON as the manual export, so restoring one uses the existing
// 数据备份 → 导入 flow. AI keys and mailbox passwords inside it stay encrypted
// with this computer's own secret, which is never written to the backup.

export const AUTO_BACKUP_PREFIX = "求职罗盘自动备份-";
const BACKUP_NAME = /^求职罗盘自动备份-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/;

export type AutoBackupOutcome = {
  ran: boolean;
  fileName?: string;
  sizeMb?: string;
  folder?: string | null;
  webdav?: boolean;
  error?: string;
};

export type WebdavTarget = { url: string; user: string; password: string };

function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${AUTO_BACKUP_PREFIX}${stamp}.json`;
}

/** Newest-first list of names to delete so only `keep` backups remain. */
export function backupsToPrune(names: string[], keep: number): string[] {
  return names.filter((name) => BACKUP_NAME.test(name)).sort().reverse().slice(Math.max(1, keep));
}

export async function assertWritableFolder(folder: string): Promise<void> {
  if (!path.isAbsolute(folder)) throw new Error("备份文件夹要填完整路径");
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error("备份文件夹不存在，请先在访达/资源管理器里建好");
  await access(folder, fsConstants.W_OK).catch(() => {
    throw new Error("没有写入这个文件夹的权限");
  });
}

/** Creates the last path segment when its parent exists ("…/iCloud Drive/求职罗盘备份"). */
export async function prepareFolder(folder: string): Promise<void> {
  if (!path.isAbsolute(folder)) throw new Error("备份文件夹要填完整路径");
  const exists = await stat(folder).then((info) => info.isDirectory()).catch(() => false);
  if (!exists) {
    const parent = await stat(path.dirname(folder)).then((info) => info.isDirectory()).catch(() => false);
    if (!parent) throw new Error("备份文件夹不存在，请先在访达/资源管理器里建好");
    await mkdir(folder);
  }
  await assertWritableFolder(folder);
}

/**
 * Cloud-drive folders that exist on this computer. A backup written inside one
 * is uploaded by that drive's own client — no credentials needed here.
 */
export async function cloudFolderSuggestions(): Promise<{ label: string; path: string }[]> {
  const home = os.homedir();
  const candidates: { label: string; path: string }[] = [
    { label: "iCloud 云盘", path: path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs") },
    { label: "OneDrive", path: path.join(home, "OneDrive") },
    { label: "坚果云", path: path.join(home, "Nutstore Files") },
    { label: "坚果云", path: path.join(home, "坚果云") },
    { label: "Dropbox", path: path.join(home, "Dropbox") },
    { label: "百度网盘同步空间", path: path.join(home, "BaiduNetdiskWorkspace") },
  ];
  // macOS File Provider drives: ~/Library/CloudStorage/OneDrive-个人, GoogleDrive-…
  const cloudStorage = path.join(home, "Library", "CloudStorage");
  for (const name of await readdir(cloudStorage).catch(() => [] as string[])) {
    candidates.push({ label: name.replace(/-.*$/, ""), path: path.join(cloudStorage, name) });
  }
  const found: { label: string; path: string }[] = [];
  for (const candidate of candidates) {
    if (await stat(candidate.path).then((info) => info.isDirectory()).catch(() => false)) {
      found.push({ label: candidate.label, path: path.join(candidate.path, "求职罗盘备份") });
    }
  }
  return found;
}

async function backupToFolder(folder: string, fileName: string, payload: string, keep: number) {
  await assertWritableFolder(folder);
  // Write then rename, so a sync client never uploads a half-written file.
  const temp = path.join(folder, `.${fileName}.partial`);
  await writeFile(temp, payload, "utf8");
  await rename(temp, path.join(folder, fileName));
  for (const old of backupsToPrune(await readdir(folder), keep)) {
    await unlink(path.join(folder, old)).catch(() => {});
  }
}

function davBase(url: string): string {
  const trimmed = url.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) throw new Error("WebDAV 请使用不含账号、查询或片段的 HTTPS 地址");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function davHeaders(target: WebdavTarget, extra: Record<string, string> = {}) {
  return { Authorization: `Basic ${Buffer.from(`${target.user}:${target.password}`).toString("base64")}`, ...extra };
}

async function davRequest(target: WebdavTarget, method: string, url: string, init: { body?: string; headers?: Record<string, string>; timeoutMs?: number } = {}) {
  davBase(url);
  const res = await fetch(url, {
    redirect: "manual",
    method,
    headers: davHeaders(target, init.headers),
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 30000),
  });
  if (res.status >= 300 && res.status < 400) throw new Error("WebDAV 地址发生重定向，请填写最终 HTTPS 地址");
  if (res.status === 401 || res.status === 403) throw new Error("WebDAV 账号或应用密码不对");
  return res;
}

/** Names directly inside the WebDAV folder (one PROPFIND, Depth: 1). */
export function parsePropfindNames(xml: string): string[] {
  const names: string[] = [];
  for (const match of xml.matchAll(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/gi)) {
    const href = match[1].trim().replace(/\/$/, "");
    const last = href.slice(href.lastIndexOf("/") + 1);
    try {
      names.push(decodeURIComponent(last));
    } catch {
      names.push(last);
    }
  }
  return names;
}

export async function testWebdav(target: WebdavTarget): Promise<void> {
  const base = davBase(target.url);
  const res = await davRequest(target, "PROPFIND", base, { headers: { Depth: "0" } });
  if (res.status === 404) {
    const created = await davRequest(target, "MKCOL", base);
    if (!created.ok && created.status !== 405) throw new Error(`WebDAV 文件夹不存在，也没能创建（${created.status}）`);
    return;
  }
  if (!res.ok && res.status !== 207) throw new Error(`WebDAV 连接失败（${res.status}）`);
}

async function backupToWebdav(target: WebdavTarget, fileName: string, payload: string, keep: number) {
  const base = davBase(target.url);
  await testWebdav(target);
  const put = await davRequest(target, "PUT", base + encodeURIComponent(fileName), {
    body: payload,
    headers: { "Content-Type": "application/json" },
    timeoutMs: 180000,
  });
  if (!put.ok) throw new Error(`上传到 WebDAV 失败（${put.status}）`);
  const list = await davRequest(target, "PROPFIND", base, { headers: { Depth: "1" } });
  if (!list.ok && list.status !== 207) return; // uploaded fine; pruning is best-effort
  for (const old of backupsToPrune(parsePropfindNames(await list.text()), keep)) {
    await davRequest(target, "DELETE", base + encodeURIComponent(old)).catch(() => {});
  }
}

/**
 * Runs a backup when one is due (or always, with `force`). Every configured
 * destination is attempted; the first failure is recorded on the user and
 * returned, and a success is only stamped when all destinations succeeded,
 * so a broken WebDAV keeps being retried and keeps showing its error.
 */
export async function runAutoBackup({ force = false } = {}): Promise<AutoBackupOutcome> {
  const user = await db.user.findUnique({
    where: { id: LOCAL_USER_ID },
    select: {
      autoBackupEnabled: true,
      autoBackupIntervalHours: true,
      autoBackupKeep: true,
      autoBackupDir: true,
      webdavUrl: true,
      webdavUser: true,
      webdavPasswordEncrypted: true,
      autoBackupLastAt: true,
    },
  });
  if (!user) return { ran: false };
  if (!force) {
    if (!user.autoBackupEnabled) return { ran: false };
    const intervalMs = Math.max(1, user.autoBackupIntervalHours) * 3600 * 1000;
    if (user.autoBackupLastAt && Date.now() - user.autoBackupLastAt.getTime() < intervalMs) return { ran: false };
  }
  const hasWebdav = !!(user.webdavUrl && user.webdavUser && user.webdavPasswordEncrypted);
  if (!user.autoBackupDir && !hasWebdav) {
    return { ran: false, error: "还没设置备份位置：选一个网盘同步文件夹，或填写 WebDAV" };
  }

  const fileName = backupFileName();
  const errors: string[] = [];
  let payload = "";
  try {
    ({ payload } = await buildBackupPayload());
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "生成备份失败");
  }
  if (payload && user.autoBackupDir) {
    await backupToFolder(user.autoBackupDir, fileName, payload, user.autoBackupKeep).catch((err) => {
      errors.push(`文件夹：${err instanceof Error ? err.message : "写入失败"}`);
    });
  }
  if (payload && hasWebdav) {
    try {
      const target = { url: user.webdavUrl!, user: user.webdavUser!, password: decryptSecret(user.webdavPasswordEncrypted!) };
      await backupToWebdav(target, fileName, payload, user.autoBackupKeep);
    } catch (err) {
      errors.push(`WebDAV：${err instanceof Error ? (err.name === "TimeoutError" ? "连接超时" : err.message) : "上传失败"}`);
    }
  }

  const error = errors.join("；") || null;
  await db.user.update({
    where: { id: LOCAL_USER_ID },
    data: error ? { autoBackupLastError: error.slice(0, 500) } : { autoBackupLastAt: new Date(), autoBackupLastError: null, lastBackupAt: new Date() },
  });
  return {
    ran: true,
    fileName,
    sizeMb: (Buffer.byteLength(payload) / 1024 / 1024).toFixed(1),
    folder: user.autoBackupDir,
    webdav: hasWebdav,
    error: error ?? undefined,
  };
}
