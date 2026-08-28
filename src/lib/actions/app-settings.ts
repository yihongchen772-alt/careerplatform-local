"use server";

import path from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/app-settings-shared";
import { applyProxy } from "@/lib/proxy-agent";

/**
 * Both sides agree on this path: main.js builds it from
 * app.getPath("userData"), and the Next server derives the same directory
 * from LOCAL_UPLOADS_DIR's parent.
 */
function settingsPath(): string {
  const uploads = process.env.LOCAL_UPLOADS_DIR;
  const dir = uploads ? path.dirname(uploads) : process.cwd();
  return path.join(dir, "app-settings.json");
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // No file yet (or unreadable) — the defaults are the correct answer.
    return DEFAULT_APP_SETTINGS;
  }
}

export async function updateAppSettings(
  next: Partial<AppSettings>
): Promise<ActionResult<AppSettings>> {
  return toActionResult(async () => {
    await requireUser();
    const merged = { ...(await getAppSettings()), ...next };
    const file = settingsPath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(merged, null, 2), "utf8");
    if ("proxyUrl" in next) applyProxy(merged.proxyUrl);
    revalidatePath("/settings");
    return merged;
  });
}

/**
 * Lets someone who can't tell why AI features aren't working check, in one
 * click, whether this machine can actually reach Gemini's API right now —
 * rather than "配置 Key 之后 AI 还是没反应" being a dead end with no way to
 * tell whether the problem is the proxy, the key, or something else.
 *
 * Takes the proxy URL as an argument rather than reading the saved setting,
 * so the button in the UI tests whatever's currently typed in the box —
 * including a value the user hasn't saved yet. Uses a per-call dispatcher
 * (undici's fetch `dispatcher` option) instead of touching the process-wide
 * one, so a test never has a side effect on the app's actual outbound
 * traffic regardless of whether it passes or fails.
 */
export async function testProxyConnection(
  proxyUrl?: string
): Promise<ActionResult<{ ms: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const { ProxyAgent } = await import("undici");
    const trimmed = proxyUrl?.trim();
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      await fetch("https://generativelanguage.googleapis.com/", {
        signal: controller.signal,
        // @ts-expect-error -- undici-specific fetch option, not in the DOM lib types
        dispatcher: trimmed ? new ProxyAgent(trimmed) : undefined,
      });
      clearTimeout(timeout);
    } catch {
      throw new UserFacingError(
        trimmed
          ? "用这个代理地址连不上 Google——检查一下端口是不是代理软件的 HTTP 端口（不是 SOCKS5），代理有没有开着"
          : "没填代理、直接连不上 Google——如果你平时上网需要开代理/VPN，把代理地址填在上面再测一次"
      );
    }
    return { ms: Date.now() - start };
  });
}
