import { UserFacingError } from "@/lib/action-result";
import {
  type UserAiConfig,
  type AiProviderId,
  getUserAiConfig,
  getUserAiKey,
  withSchemaReminder,
  extractJson,
} from "@/lib/ai-providers";
import {
  generateStructured as geminiGenerateStructured,
  generateGrounded as geminiGenerateGrounded,
  GeminiError,
  type GeminiFilePart,
  type GeminiSchema,
} from "@/lib/gemini";

export type { GeminiFilePart as FilePart };

/**
 * Providers whose API can (a) read a PDF/image directly and (b) do live web
 * search — the only three of the six providers this app supports where
 * that's actually true. DeepSeek/Kimi/Qwen's chat-completions APIs are
 * text-only, no file input, no search tool.
 */
export const FILE_SEARCH_CAPABLE: readonly AiProviderId[] = ["gemini", "anthropic", "openai"];

/**
 * The key to use for file-reading/search features: prefers the user's
 * default provider if it happens to be a capable one (so "AI 搜索" uses
 * whatever they've already made their main provider), otherwise falls back
 * to whichever capable provider they've configured, checked in a fixed order.
 */
export async function getFileSearchKey(userId: string): Promise<UserAiConfig | null> {
  const defaultConfig = await getUserAiConfig(userId);
  if (defaultConfig && FILE_SEARCH_CAPABLE.includes(defaultConfig.provider)) {
    return defaultConfig;
  }
  for (const provider of FILE_SEARCH_CAPABLE) {
    const key = await getUserAiKey(userId, provider);
    if (key) return key;
  }
  return null;
}

function unsupportedProviderError(): never {
  throw new UserFacingError(
    "当前配置的服务商不支持读文件/联网搜索，请在账号设置里配一个 Gemini、Claude 或 OpenAI 的 Key"
  );
}

// ---------- Anthropic (Claude) ----------

const ANTHROPIC_VERSION = "2023-06-01";

function claudeFileBlock(file: GeminiFilePart): Record<string, unknown> {
  if (file.mimeType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.data },
    };
  }
  return {
    type: "image",
    source: { type: "base64", media_type: file.mimeType, data: file.data },
  };
}

async function claudeRequest(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ contentBlocks: { type: string; text?: string }[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      // 8192, not the previous 4096 — a resume check's strengths/issues/
      // suggestions arrays or a multi-question interview Q&A generation can
      // plausibly exceed 4096 and get cut off mid-JSON.
      body: JSON.stringify({ model, max_tokens: 8192, ...body }),
    });
  } catch {
    throw new UserFacingError("AI 请求超时，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[anthropic-file] ${response.status}`, detail.slice(0, 500));
    if (response.status === 401) throw new UserFacingError("API Key 无效，请检查账号设置里的 AI 配置");
    if (response.status === 429) throw new UserFacingError("API 调用超限，请稍后重试");
    throw new UserFacingError("AI 服务暂时不可用，请稍后重试");
  }

  const data = await response.json();
  if (data?.stop_reason === "max_tokens") {
    throw new UserFacingError("AI 回答内容太长被截断了，请重试（有时候换一次就好）");
  }
  return { contentBlocks: data?.content ?? [] };
}

function lastText(contentBlocks: { type: string; text?: string }[]): string {
  const textBlocks = contentBlocks.filter((b) => b.type === "text" && b.text);
  return textBlocks[textBlocks.length - 1]?.text ?? "";
}

async function claudeStructuredWithFile(
  apiKey: string,
  model: string,
  prompt: string,
  file: GeminiFilePart | undefined,
  schema: GeminiSchema,
  timeoutMs: number
): Promise<unknown> {
  const content: Record<string, unknown>[] = [];
  if (file) content.push(claudeFileBlock(file));
  content.push({ type: "text", text: withSchemaReminder(prompt, schema) });

  const { contentBlocks } = await claudeRequest(
    apiKey,
    model,
    { messages: [{ role: "user", content }] },
    timeoutMs
  );
  return extractJson(lastText(contentBlocks));
}

async function claudeGrounded(
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const { contentBlocks } = await claudeRequest(
    apiKey,
    model,
    {
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    },
    timeoutMs
  );
  const text = lastText(contentBlocks);
  if (!text) throw new UserFacingError("AI 没有返回结果，请重试");
  return text;
}

// ---------- OpenAI (Responses API) ----------

function openAiFilePart(file: GeminiFilePart): Record<string, unknown> {
  const dataUrl = `data:${file.mimeType};base64,${file.data}`;
  if (file.mimeType === "application/pdf") {
    return { type: "input_file", file_data: dataUrl, filename: "file.pdf" };
  }
  return { type: "input_image", image_url: dataUrl };
}

async function openAiResponsesRequest(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, max_output_tokens: 8192, ...body }),
    });
  } catch {
    throw new UserFacingError("AI 请求超时，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[openai-file] ${response.status}`, detail.slice(0, 500));
    if (response.status === 401) throw new UserFacingError("API Key 无效，请检查账号设置里的 AI 配置");
    if (response.status === 429) throw new UserFacingError("API 调用超限，请稍后重试");
    throw new UserFacingError("AI 服务暂时不可用，请稍后重试");
  }

  const data = await response.json();
  if (data?.incomplete_details?.reason === "max_output_tokens") {
    throw new UserFacingError("AI 回答内容太长被截断了，请重试（有时候换一次就好）");
  }
  const text: string = data?.output_text ?? "";
  if (!text) throw new UserFacingError("AI 没有返回结果，请重试");
  return text;
}

async function openAiStructuredWithFile(
  apiKey: string,
  model: string,
  prompt: string,
  file: GeminiFilePart | undefined,
  schema: GeminiSchema,
  timeoutMs: number
): Promise<unknown> {
  const content: Record<string, unknown>[] = [];
  if (file) content.push(openAiFilePart(file));
  content.push({ type: "input_text", text: withSchemaReminder(prompt, schema) });

  const text = await openAiResponsesRequest(
    apiKey,
    model,
    { input: [{ role: "user", content }] },
    timeoutMs
  );
  return extractJson(text);
}

async function openAiGrounded(
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  return openAiResponsesRequest(
    apiKey,
    model,
    { input: prompt, tools: [{ type: "web_search" }] },
    timeoutMs
  );
}

// ---------- Dispatch ----------

/**
 * Structured JSON output over an optional file (PDF/image), routed to
 * whichever capable provider `config` names. Gemini gets its native
 * enforced responseSchema; Claude/OpenAI get the same prompt-based
 * schema-reminder + fenced-JSON-extraction approach already proven for
 * DeepSeek/Kimi's text-only path (see withSchemaReminder/extractJson).
 */
export async function generateStructuredWithFile({
  config,
  prompt,
  file,
  schema,
  thinkingBudget = 1024,
  timeoutMs = 90000,
}: {
  config: UserAiConfig;
  prompt: string;
  file?: GeminiFilePart;
  schema: GeminiSchema;
  thinkingBudget?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  switch (config.provider) {
    case "gemini":
      return geminiGenerateStructured({
        prompt,
        file,
        schema,
        thinkingBudget,
        timeoutMs,
        apiKey: config.apiKey,
        model: config.model,
      });
    case "anthropic":
      return claudeStructuredWithFile(config.apiKey, config.model, prompt, file, schema, timeoutMs);
    case "openai":
      return openAiStructuredWithFile(config.apiKey, config.model, prompt, file, schema, timeoutMs);
    default:
      unsupportedProviderError();
  }
}

/** Search-grounded plain-text generation, routed to whichever capable provider `config` names. */
export async function generateGroundedText({
  config,
  prompt,
  timeoutMs = 45000,
}: {
  config: UserAiConfig;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  switch (config.provider) {
    case "gemini":
      return geminiGenerateGrounded({
        prompt,
        timeoutMs,
        apiKey: config.apiKey,
        model: config.model,
      });
    case "anthropic":
      return claudeGrounded(config.apiKey, config.model, prompt, timeoutMs);
    case "openai":
      return openAiGrounded(config.apiKey, config.model, prompt, timeoutMs);
    default:
      unsupportedProviderError();
  }
}

export { GeminiError };
