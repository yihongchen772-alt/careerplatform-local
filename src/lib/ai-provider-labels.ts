/**
 * Pure metadata, no server-only imports (crypto/db) — safe to import from
 * client components. src/lib/ai-providers.ts (server-only) re-exports the
 * type and imports AI_PROVIDER_META from here so the two never drift apart.
 */
export type AiProviderId = "gemini" | "openai" | "deepseek" | "kimi" | "anthropic";

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
];
