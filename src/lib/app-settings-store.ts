import path from "path";
import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/app-settings-shared";

export function appDataDir(): string {
  const uploads = process.env.LOCAL_UPLOADS_DIR;
  return uploads ? path.dirname(uploads) : process.cwd();
}

export function appSettingsPath(): string {
  return path.join(appDataDir(), "app-settings.json");
}

function webhookStatePath(): string {
  return path.join(appDataDir(), "webhook-state.json");
}

async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(data, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function readAppSettingsFile(): Promise<AppSettings> {
  try {
    const file = appSettingsPath();
    const raw = await readFile(file, "utf8");
    let status = {};
    try {
      status = JSON.parse(await readFile(path.join(path.dirname(file), "app-settings-status.json"), "utf8"));
    } catch {
      /* No OS status yet. */
    }
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw), ...status };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export async function writeAppSettingsFile(next: AppSettings): Promise<void> {
  await atomicWriteJson(appSettingsPath(), next);
}

export type WebhookDispatchState = {
  lastDigestDay?: string;
  lastError?: string | null;
};

export async function readWebhookState(): Promise<WebhookDispatchState> {
  try {
    const parsed = JSON.parse(await readFile(webhookStatePath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeWebhookState(next: WebhookDispatchState): Promise<void> {
  await atomicWriteJson(webhookStatePath(), next);
}
