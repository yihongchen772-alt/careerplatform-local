"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import type { AppSettings } from "@/lib/app-settings-shared";
import { readAppSettingsFile, writeAppSettingsFile } from "@/lib/app-settings-store";
import { applyProxy } from "@/lib/proxy-agent";
import {
  WEBHOOK_PROVIDER_LABELS,
  sendWebhookNotification,
  validateWebhookUrl,
} from "@/lib/webhook";

export async function getAppSettings(): Promise<AppSettings> {
  return readAppSettingsFile();
}

export async function updateAppSettings(
  next: Partial<AppSettings>
): Promise<ActionResult<AppSettings>> {
  return toActionResult(async () => {
    await requireUser();
    const patch = z.object({
      autoLaunch: z.boolean().optional(), notesAtLogin: z.boolean().optional(), backgroundReminders: z.boolean().optional(),
      inboxScanIntervalHours: z.number().refine((v) => [0, 1, 2, 4, 6, 12].includes(v)).optional(),
      jobRadarIntervalHours: z.number().refine((v) => [0, 6, 12, 24].includes(v)).optional(),
      applicationSyncIntervalHours: z.number().refine((v) => [0, 6, 12, 24].includes(v)).optional(),
      postingSheetIntervalHours: z.number().refine((v) => [0, 1, 3, 6].includes(v)).optional(),
      proxyUrl: z.string().trim().max(1000).optional(),
      webhookUrl: z.string().trim().max(1000).optional(),
    }).strict().safeParse(next);
    if (!patch.success) throw new UserFacingError("设置格式或检查频率不支持");
    if (patch.data.webhookUrl !== undefined && patch.data.webhookUrl !== "") {
      const normalized = validateWebhookUrl(patch.data.webhookUrl);
      if (!normalized) {
        throw new UserFacingError("Webhook 地址无效，请填 http:// 或 https:// 开头的完整 URL");
      }
      patch.data.webhookUrl = normalized;
    }
    const merged = { ...(await readAppSettingsFile()), ...patch.data };
    await writeAppSettingsFile(merged);
    if ("proxyUrl" in next) applyProxy(merged.proxyUrl);
    revalidatePath("/settings");
    return merged;
  });
}

export async function testWebhookNotification(
  webhookUrl?: string
): Promise<ActionResult<{ providerLabel: string }>> {
  return toActionResult(async () => {
    await requireUser();
    const saved = await readAppSettingsFile();
    const target = (webhookUrl !== undefined ? webhookUrl : saved.webhookUrl ?? "").trim();
    const normalized = validateWebhookUrl(target);
    if (!normalized) {
      throw new UserFacingError("先填写有效的飞书 / 钉钉 / 企业微信或自定义 Webhook 地址");
    }
    const res = await sendWebhookNotification(normalized, {
      event: "test",
      title: "Webhook 测试通知",
      body: "求职罗盘推送通道已连通！后续有面试/笔试提醒或网申进度变化时，将自动同步到此处。",
      items: ["支持飞书 / Lark 机器人", "支持钉钉机器人", "支持企业微信与自定义 JSON Webhook"],
    });
    if (!res.ok) {
      throw new UserFacingError(`Webhook 发送失败：${res.error || "请检查机器人关键词或网络设置"}`);
    }
    return { providerLabel: WEBHOOK_PROVIDER_LABELS[res.provider] };
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
