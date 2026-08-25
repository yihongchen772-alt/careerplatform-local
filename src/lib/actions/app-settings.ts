"use server";

import path from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/app-settings-shared";

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
    revalidatePath("/settings");
    return merged;
  });
}
