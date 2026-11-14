import { readAppSettingsFile } from "@/lib/app-settings-store";

export type WebhookProvider = "feishu" | "dingtalk" | "wecom" | "generic";

export type WebhookMessage = {
  event: "interview_reminder" | "daily_digest" | "portal_sync" | "test";
  title: string;
  body: string;
  items?: string[];
};

export const WEBHOOK_PROVIDER_LABELS: Record<WebhookProvider, string> = {
  feishu: "飞书 / Lark 机器人",
  dingtalk: "钉钉机器人",
  wecom: "企业微信机器人",
  generic: "自定义 Webhook",
};

/** Validates and normalizes an outbound HTTP/HTTPS webhook URL. */
export function validateWebhookUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "169.254.169.254" || host === "metadata.google.internal") return null;
  return parsed.toString();
}

export function detectWebhookProvider(url: string): WebhookProvider {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("feishu.cn") || host.endsWith("larksuite.com")) return "feishu";
    if (host.endsWith("dingtalk.com")) return "dingtalk";
    if (host === "qyapi.weixin.qq.com") return "wecom";
  } catch {
    /* Fallback to generic */
  }
  return "generic";
}

export function buildWebhookPayload(provider: WebhookProvider, msg: WebhookMessage): Record<string, unknown> {
  const lines = [`【求职罗盘】${msg.title}`];
  if (msg.body.trim()) lines.push(msg.body.trim());
  if (msg.items && msg.items.length > 0) {
    lines.push(...msg.items.slice(0, 8).map((item) => `• ${item}`));
    if (msg.items.length > 8) lines.push(`…另有 ${msg.items.length - 8} 项`);
  }
  const text = lines.join("\n");

  if (provider === "feishu") {
    return { msg_type: "text", content: { text } };
  }
  if (provider === "dingtalk" || provider === "wecom") {
    return { msgtype: "text", text: { content: text } };
  }
  return {
    source: "JobCompass",
    event: msg.event,
    title: msg.title,
    body: msg.body,
    items: msg.items ?? [],
    text,
    timestamp: new Date().toISOString(),
  };
}

function checkProviderBodyError(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  const code =
    typeof record.errcode === "number"
      ? record.errcode
      : typeof record.code === "number"
        ? record.code
        : typeof record.StatusCode === "number"
          ? record.StatusCode
          : 0;
  if (code === 0) return null;
  const detail =
    typeof record.errmsg === "string"
      ? record.errmsg
      : typeof record.msg === "string"
        ? record.msg
        : typeof record.StatusMessage === "string"
          ? record.StatusMessage
          : `错误码 ${code}`;
  return detail;
}

/** Sends a webhook notification using Feishu, DingTalk, WeCom, or generic JSON schema. */
export async function sendWebhookNotification(
  rawUrl: string,
  msg: WebhookMessage,
  timeoutMs = 8000,
): Promise<{ ok: boolean; provider: WebhookProvider; status?: number; error?: string }> {
  const url = validateWebhookUrl(rawUrl);
  if (!url) {
    return { ok: false, provider: "generic", error: "Webhook 地址无效，请填 http:// 或 https:// 开头的完整 URL" };
  }
  const provider = detectWebhookProvider(url);
  const payload = buildWebhookPayload(provider, msg);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* Plain text response */
    }
    const bodyError = checkProviderBodyError(parsed);
    if (!res.ok || bodyError) {
      return {
        ok: false,
        provider,
        status: res.status,
        error: bodyError || `Webhook 返回 HTTP ${res.status}`,
      };
    }
    return { ok: true, provider, status: res.status };
  } catch (err) {
    return {
      ok: false,
      provider,
      error: err instanceof Error ? err.message : "Webhook 网络请求失败",
    };
  }
}

/** Dispatches a notification only if webhookUrl is configured in app settings. */
export async function notifyWebhookIfConfigured(msg: WebhookMessage): Promise<boolean> {
  try {
    const settings = await readAppSettingsFile();
    const url = settings.webhookUrl?.trim();
    if (!url) return false;
    const outcome = await sendWebhookNotification(url, msg);
    return outcome.ok;
  } catch {
    return false;
  }
}
