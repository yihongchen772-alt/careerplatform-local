import { UserFacingError } from "@/lib/action-result";
import {
  type UserAiConfig,
  getUserAiConfig,
  getUserAiKey,
  withSchemaReminder,
  extractJson,
  callOpenAiCompatible,
  OPENAI_COMPATIBLE_BASE_URL,
} from "@/lib/ai-providers";
import {
  FILE_CAPABLE_PROVIDERS,
  IMAGE_CAPABLE_PROVIDERS,
  SEARCH_CAPABLE_PROVIDERS,
  type AiProviderId,
} from "@/lib/ai-provider-labels";
import {
  generateStructured as geminiGenerateStructured,
  generateGrounded as geminiGenerateGrounded,
  GeminiError,
  type GeminiFilePart,
  type GeminiSchema,
} from "@/lib/gemini";

export type { GeminiFilePart as FilePart };

/**
 * Picks a key for a capability the user's default provider may not have:
 * prefers the default when it qualifies (so the feature uses whatever they
 * already chose), otherwise falls back to the first configured provider in
 * `capable` order.
 */
async function getCapableKey(
  userId: string,
  capable: readonly AiProviderId[]
): Promise<UserAiConfig | null> {
  const defaultConfig = await getUserAiConfig(userId);
  if (defaultConfig && capable.includes(defaultConfig.provider)) return defaultConfig;
  for (const provider of capable) {
    const key = await getUserAiKey(userId, provider);
    if (key) return key;
  }
  return null;
}

/** For features that must read a PDF specifically (resume check/match when
 * the file turns out to be a PDF, not an image — see FILE_CAPABLE_PROVIDERS
 * for why this is a strict subset of the image-capable list). */
export async function getFileSearchKey(userId: string): Promise<UserAiConfig | null> {
  return getCapableKey(userId, FILE_CAPABLE_PROVIDERS);
}

/** For features that only need to read an image (screenshot import; resume
 * check/match when the uploaded file is an image rather than a PDF). Wider
 * than getFileSearchKey — DeepSeek/Kimi/Qwen can all do this now, just not PDFs. */
export async function getImageSearchKey(userId: string): Promise<UserAiConfig | null> {
  return getCapableKey(userId, IMAGE_CAPABLE_PROVIDERS);
}

/** For features that must search the live web (company research, job insight). */
export async function getSearchKey(userId: string): Promise<UserAiConfig | null> {
  return getCapableKey(userId, SEARCH_CAPABLE_PROVIDERS);
}

function unsupportedFileError(): never {
  throw new UserFacingError(
    "当前配置的服务商不支持读取 PDF，请在账号设置里配一个 Gemini、Claude、OpenAI 或 Qwen 的 Key（DeepSeek/Kimi 能读图片，但读不了 PDF）"
  );
}

function unsupportedSearchError(): never {
  throw new UserFacingError(
    "当前配置的服务商不支持联网搜索，请在账号设置里配一个 Qwen、Gemini、Claude 或 OpenAI 的 Key"
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


// ---------- Qwen (Alibaba Model Studio, OpenAI-compatible + enable_search) ----------

/**
 * Alibaba's OpenAI-compatible endpoint accepts a non-standard `enable_search`
 * flag that makes the model search the live web server-side
 * (https://help.aliyun.com/zh/model-studio/web-search). Python users pass it
 * via the SDK's `extra_body`; over raw HTTP it's simply another field in the
 * request body. Unlike Gemini's grounding this isn't metered separately from
 * ordinary generation, which is why Qwen is tried first for search features.
 */
async function qwenGrounded(
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number,
  baseUrl?: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl || OPENAI_COMPATIBLE_BASE_URL.qwen}/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          enable_search: true,
          // No search_strategy here on purpose: the page-fetching strategies
          // ("agent_max" and friends, i.e. Web Extractor) are rejected on
          // non-streaming calls — measured: 400 "Non-streaming mode does not
          // support Web Extractor." Plain enable_search works and answers
          // from search results, which is what this needs.
          max_tokens: 4096,
        }),
      }
    );
  } catch {
    throw new UserFacingError("AI 请求超时，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[qwen-search] ${response.status}`, detail.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new UserFacingError("API Key 无效，请检查账号设置里的 AI 配置");
    }
    if (response.status === 429) throw new UserFacingError("API 调用超限，请稍后重试");
    throw new UserFacingError("AI 服务暂时不可用，请稍后重试");
  }

  const data = await response.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new UserFacingError("AI 没有返回结果，请重试");
  return text;
}

// ---------- Qwen document (PDF) understanding ----------

/**
 * Qwen's vision models (qwenGrounded's sibling in ai-providers.ts's
 * VISION_MODEL) can't read a PDF at all — but DashScope has a completely
 * separate mechanism for that: an OpenAI-compatible Files endpoint
 * (purpose=file-extract, PDF/DOCX/TXT/... up to 150MB) that returns a
 * file id, referenced in a second `system` message as `fileid://{id}` on
 * qwen-long specifically (https://help.aliyun.com/zh/model-studio/openai-file-interface,
 * https://help.aliyun.com/zh/model-studio/long-context-qwen-long — checked
 * directly, this is not the same code path as the vision image_url blocks).
 * Two HTTP calls where every other provider here needs one, but it's the
 * only way Qwen can read a resume PDF at all.
 */
async function qwenUploadFile(
  apiKey: string,
  file: GeminiFilePart,
  baseUrl: string,
  timeoutMs: number
): Promise<string> {
  const ext = file.mimeType === "application/pdf" ? "pdf" : "bin";
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from(file.data, "base64")], { type: file.mimeType }),
    `resume.${ext}`
  );
  form.append("purpose", "file-extract");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/files`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new UserFacingError("AI 请求超时，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[qwen-file-upload] ${response.status}`, detail.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new UserFacingError("API Key 无效，请检查账号设置里的 AI 配置");
    }
    throw new UserFacingError("上传文件给 AI 失败，请稍后重试");
  }

  const data = await response.json();
  const fileId: string | undefined = data?.id;
  if (!fileId) throw new UserFacingError("AI 没有返回文件 id，请重试");
  return fileId;
}

async function qwenDocumentStructured(
  apiKey: string,
  prompt: string,
  file: GeminiFilePart,
  schema: GeminiSchema,
  timeoutMs: number,
  baseUrlOverride?: string
): Promise<unknown> {
  const baseUrl = baseUrlOverride || OPENAI_COMPATIBLE_BASE_URL.qwen;
  const fileId = await qwenUploadFile(apiKey, file, baseUrl, timeoutMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen-long",
        // Per DashScope's own doc structure: first system message is the
        // role/instructions, second is the fileid:// reference, then the
        // user message is the actual ask — the file content isn't put
        // directly in the user message.
        messages: [
          { role: "system", content: withSchemaReminder(prompt, schema) },
          { role: "system", content: `fileid://${fileId}` },
          { role: "user", content: "请阅读这份文件并按上面的要求输出结果。" },
        ],
        response_format: { type: "json_object" },
        max_tokens: 8192,
      }),
    });
  } catch {
    throw new UserFacingError("AI 请求超时，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[qwen-long] ${response.status}`, detail.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new UserFacingError("API Key 无效，请检查账号设置里的 AI 配置");
    }
    if (response.status === 429) throw new UserFacingError("API 调用超限，请稍后重试");
    throw new UserFacingError("AI 服务暂时不可用，请稍后重试");
  }

  const data = await response.json();
  if (data?.choices?.[0]?.finish_reason === "length") {
    throw new UserFacingError("AI 回答内容太长被截断了，请重试（有时候换一次就好）");
  }
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  return extractJson(text);
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
    case "qwen":
      // PDF and image are two entirely different mechanisms on Qwen: a PDF
      // goes through the upload-then-fileid:// document path (qwen-long),
      // an image goes through the same vision image_url blocks DeepSeek/
      // Kimi use. Neither is the account's configured (text) model.
      if (file && file.mimeType === "application/pdf") {
        return qwenDocumentStructured(config.apiKey, prompt, file, schema, timeoutMs, config.baseUrl);
      }
      return callOpenAiCompatible(
        config.provider,
        config.apiKey,
        config.model,
        withSchemaReminder(prompt, schema),
        timeoutMs,
        config.baseUrl,
        file
      );
    case "deepseek":
    case "kimi":
      // Images only — DeepSeek/Kimi have no equivalent to Qwen's document
      // upload path. A caller that already knows the file is a PDF should
      // be requesting a key via getFileSearchKey (which never returns these
      // two) rather than reaching this branch; this is the backstop for the
      // case where it didn't.
      if (file?.mimeType === "application/pdf") {
        throw new UserFacingError(
          "DeepSeek/Kimi 读不了 PDF，只能读图片——换一个能读 PDF 的服务商（Gemini/Claude/OpenAI/Qwen），或者把简历转成图片再传"
        );
      }
      return callOpenAiCompatible(
        config.provider,
        config.apiKey,
        config.model,
        withSchemaReminder(prompt, schema),
        timeoutMs,
        config.baseUrl,
        file
      );
    default:
      unsupportedFileError();
  }
}

/** Search-grounded plain-text generation, routed to whichever capable provider `config` names. */
export async function generateGroundedText({
  config,
  prompt,
  // 90s, not 45s: a live search round-trip is far slower than plain
  // generation — a measured Qwen `enable_search` call took ~41s, which would
  // have been a coin flip against the old default.
  timeoutMs = 90000,
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
    case "qwen":
      return qwenGrounded(config.apiKey, config.model, prompt, timeoutMs, config.baseUrl);
    default:
      unsupportedSearchError();
  }
}

export { GeminiError };
