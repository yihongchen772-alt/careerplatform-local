import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// 网申样本 for the Chrome extension: the same folder and files the desktop
// 网申浏览器 writes (electron/browser-view.js captureSample / recordFillStats),
// next to uploads/ in the app's data folder. Structure only, never values.

const AUTO_LIMIT = 120;
// LOCAL_UPLOADS_DIR is <data folder>/uploads (electron/main.js); the samples sit beside it.
export const samplesDir = () => path.join(path.dirname(process.env.LOCAL_UPLOADS_DIR ?? path.join(process.cwd(), "uploads")), "网申样本");

export async function recordFillStats(rawUrl: string, patch: Partial<Record<"fills" | "filled" | "manual" | "typed" | "samples", number>>) {
  let host = "";
  try { host = new URL(rawUrl).hostname; } catch { return; }
  if (!host) return;
  const dir = samplesDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "填写统计.json");
  let stats: Record<string, Record<string, number | string>> = {};
  try { stats = JSON.parse(await readFile(file, "utf8")) || {}; } catch { stats = {}; }
  const row = stats[host] || { fills: 0, filled: 0, manual: 0, typed: 0, samples: 0 };
  for (const [key, value] of Object.entries(patch)) row[key] = Number(row[key] || 0) + (value || 0);
  row.lastAt = new Date().toISOString();
  stats[host] = row;
  await writeFile(file, JSON.stringify(stats, null, 1));
}

/** Saves one automatic sample (one per page a day); false when today's is already there. */
export async function saveAutoSample(page: string, body: { title: string; note: string; frames: unknown[] }, app: string) {
  const url = new URL(page);
  const dir = samplesDir();
  await mkdir(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const key = createHash("sha1").update(`${url.origin}${url.pathname}`).digest("hex").slice(0, 8);
  const prefix = `auto-${day}-${url.hostname}-${key}`;
  const names = await readdir(dir);
  if (names.some((name) => name.startsWith(prefix))) return false;
  await writeFile(path.join(dir, `${prefix}.json`), JSON.stringify({ app, page: `${url.origin}${url.pathname}`, title: body.title, capturedAt: new Date().toISOString(), auto: true, source: "extension", note: body.note, frames: body.frames }, null, 1));
  const autos = (await readdir(dir)).filter((name) => name.startsWith("auto-")).sort();
  for (const name of autos.slice(0, Math.max(0, autos.length - AUTO_LIMIT))) await rm(path.join(dir, name), { force: true });
  await recordFillStats(page, { samples: 1 });
  return true;
}
