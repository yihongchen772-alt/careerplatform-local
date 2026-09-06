/**
 * Pure metadata, no server-only imports (crypto/db) — safe to import from
 * client components. src/lib/ai-providers.ts (server-only) re-exports the
 * type and imports AI_PROVIDER_META from here so the two never drift apart.
 */
export type AiProviderId =
  | "gemini"
  | "openai"
  | "deepseek"
  | "kimi"
  | "anthropic"
  | "qwen"
  | "xai"
  | "mistral"
  | "zhipu"
  | "doubao";

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
  { id: "xai", label: "xAI Grok", defaultModel: "grok-4", keyHelp: "在 console.x.ai 生成" },
  { id: "mistral", label: "Mistral AI", defaultModel: "mistral-large-latest", keyHelp: "在 console.mistral.ai 生成" },
  { id: "zhipu", label: "智谱 AI（GLM）", defaultModel: "glm-4.6", keyHelp: "在 open.bigmodel.cn 生成" },
  {
    id: "doubao",
    label: "字节豆包（Doubao）",
    defaultModel: "ep-20260101000000-xxxxx",
    keyHelp:
      "在火山引擎控制台生成 Key；模型要填「推理接入点」ID（形如 ep-xxxxxxxxxx-xxxxx），不是模型名——先在控制台创建接入点",
  },
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
  "xai",
  "mistral",
  "zhipu",
  "doubao",
];

/**
 * Narrower alias for the exact set above — src/lib/ai-providers.ts needs a
 * literal union (not the full AiProviderId) for a few Record key types and
 * callOpenAiCompatible's parameter, so a new provider added there without
 * updating this list is a compile error rather than a silent runtime gap.
 * Keep in sync with OPENAI_COMPATIBLE_PROVIDERS's contents by hand — TS
 * can't derive a literal union from a `readonly AiProviderId[]` value.
 */
export type OpenAiCompatibleProviderId =
  | "openai"
  | "deepseek"
  | "kimi"
  | "qwen"
  | "xai"
  | "mistral"
  | "zhipu"
  | "doubao";

/**
 * Providers whose API can read a PDF directly. DeepSeek and Kimi's vision
 * models (see IMAGE_CAPABLE_PROVIDERS) are images-only — neither accepts a
 * PDF content block as of Aug 2026 (checked each vendor's current vision
 * docs directly rather than assuming OpenAI-compatible ⇒ PDF-capable).
 * Qwen is the one exception: DashScope has a completely separate
 * upload-then-reference mechanism (an OpenAI-compatible Files endpoint,
 * purpose=file-extract, then `fileid://{id}` in a system message to
 * qwen-long) that genuinely reads a PDF's content — see
 * qwenDocumentStructured in ai-file-search.ts. A resume/screenshot that's
 * already a PDF needs one of these four regardless of what the user's
 * default provider is.
 */
export const FILE_CAPABLE_PROVIDERS: readonly AiProviderId[] = [
  "gemini",
  "anthropic",
  "openai",
  "qwen",
];

/**
 * Providers whose API can read an image (not necessarily a PDF) directly.
 * DeepSeek, Kimi, and Qwen all shipped a vision-capable model on their
 * hosted platform API within the last few months — DeepSeek's
 * deepseek-v4-flash-vision-exp (Aug 2026), Kimi's kimi-k3 /
 * moonshot-v1-*-vision-preview, Qwen's qwen3-vl-plus / qwen-vl-plus — all
 * three take the same OpenAI-style `image_url` content block with a base64
 * data URI, over the same /chat/completions endpoint already used for text
 * (see VISION_MODEL in ai-providers.ts for the exact model id each one
 * needs — none of them use the account's configured *text* model for this).
 * Not a strict superset of FILE_CAPABLE_PROVIDERS here — Qwen reads a PDF
 * through an entirely different mechanism (see above) than its own vision
 * path, so it appears on both lists for different reasons.
 *
 * 智谱 (glm-4v-flash/glm-5v-turbo) and Mistral (Pixtral family / Mistral
 * Medium 3.5) both confirmed to take the same OpenAI-style `image_url`
 * block. xAI and Doubao are NOT listed — vision support is plausible for
 * both but no specific current model id was confirmed against live docs,
 * so they're left off rather than guessed (see VISION_MODEL in
 * ai-providers.ts, which needs an exact model id per entry here).
 */
export const IMAGE_CAPABLE_PROVIDERS: readonly AiProviderId[] = [
  "gemini",
  "anthropic",
  "openai",
  "deepseek",
  "kimi",
  "qwen",
  "zhipu",
  "mistral",
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
  xai: ["grok-4", "grok-4-fast"],
  mistral: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
  zhipu: ["glm-4.6", "glm-4.5-air", "glm-4.5-flash", "glm-4.6v"],
  // No safe seed: a model name here is meaningless without the user's own
  // 推理接入点 ID (see keyHelp above) — an empty list keeps the dropdown from
  // showing a name that will never work for anyone else's account.
  doubao: [],
};
