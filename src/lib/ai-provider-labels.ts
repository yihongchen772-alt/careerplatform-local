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
 * Providers whose API can read a PDF/image directly. DeepSeek/Kimi/Qwen's
 * chat-completions endpoints are text-only.
 */
export const FILE_CAPABLE_PROVIDERS: readonly AiProviderId[] = [
  "gemini",
  "anthropic",
  "openai",
];

/**
 * Providers whose API can do live web search server-side. Qwen belongs here
 * too — Alibaba's OpenAI-compatible endpoint takes an `enable_search` flag
 * (https://help.aliyun.com/zh/model-studio/web-search). DeepSeek does not:
 * its web chat has search, but the API exposes no equivalent parameter.
 * Qwen is listed first because Gemini meters Search grounding far more
 * tightly than ordinary generation, so a free Gemini key runs out almost
 * immediately while Qwen keeps working.
 */
export const SEARCH_CAPABLE_PROVIDERS: readonly AiProviderId[] = [
  "qwen",
  "gemini",
  "anthropic",
  "openai",
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

/**
 * Seed list for the model dropdown — deliberately short and NOT treated as
 * the truth. Every provider ships new model names faster than a hardcoded
 * list can track, and a stale hardcoded name is worse than no name at all
 * (it looks authoritative and then 404s at call time). The authoritative
 * list comes from listProviderModels() in src/lib/actions/ai-models.ts,
 * which asks the provider's own /models endpoint with the user's key and
 * therefore returns exactly the models that key can actually call. These
 * seeds only exist so the dropdown isn't empty before that button is
 * pressed, and so an offline/blocked network still leaves something usable.
 */
export const SEED_MODELS: Record<AiProviderId, readonly string[]> = {
  gemini: GEMINI_KNOWN_MODELS,
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  kimi: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  anthropic: [
    "claude-haiku-4-5",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-opus-4-6",
    "claude-opus-5",
  ],
  qwen: ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-long"],
};
