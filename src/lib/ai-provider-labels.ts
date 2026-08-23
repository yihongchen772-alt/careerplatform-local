/**
 * Pure metadata, no server-only imports (crypto/db) — safe to import from
 * client components. src/lib/ai-providers.ts (server-only) re-exports the
 * type and imports AI_PROVIDER_META from here so the two never drift apart.
 */
export type AiProviderId = "gemini" | "openai" | "deepseek" | "kimi" | "anthropic" | "qwen";

export const AI_PROVIDER_OPTIONS: {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  keyHelp: string;
}[] = [
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-3.5-flash-lite", keyHelp: "在 Google AI Studio 生成" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", keyHelp: "在 platform.openai.com 生成" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", keyHelp: "在 platform.deepseek.com 生成" },
  { id: "kimi", label: "Kimi（月之暗面）", defaultModel: "moonshot-v1-8k", keyHelp: "在 platform.moonshot.cn 生成" },
  { id: "anthropic", label: "Anthropic Claude", defaultModel: "claude-sonnet-4-6", keyHelp: "在 console.anthropic.com 生成" },
  { id: "qwen", label: "Qwen（通义千问）", defaultModel: "qwen-plus", keyHelp: "在阿里云百炼/DashScope 生成，OpenAI 兼容模式" },
];

/**
 * These speak the same /chat/completions wire format (OpenAI-compatible),
 * so their base URL is user-overridable — some deployments (e.g. Alibaba
 * Cloud 百炼's per-workspace MaaS gateway) aren't at the same URL for every
 * account, unlike Gemini/Anthropic which only ever have one real endpoint.
 */
export const OPENAI_COMPATIBLE_PROVIDERS: readonly AiProviderId[] = [
  "openai",
  "deepseek",
  "kimi",
  "qwen",
];

/**
 * Gemini's free-tier quota is allocated per model, not per key, so listing
 * several here (checked ones get tried in this order on a 429) is a real
 * way to get more calls out of one key per day — confirmed against a real
 * Google AI Studio account's model list.
 */
export const GEMINI_KNOWN_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
] as const;
