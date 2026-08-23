import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { generateStructured, GeminiError, type GeminiSchema } from "@/lib/gemini";
import { UserFacingError } from "@/lib/action-result";
import { AI_PROVIDER_OPTIONS, type AiProviderId } from "@/lib/ai-provider-labels";

export type { AiProviderId };

const AI_PROVIDERS: Record<AiProviderId, { defaultModel: string }> =
  Object.fromEntries(
    AI_PROVIDER_OPTIONS.map((p) => [p.id, { defaultModel: p.defaultModel }])
  ) as Record<AiProviderId, { defaultModel: string }>;

// OpenAI, DeepSeek, Kimi, and Qwen all speak the same /chat/completions wire
// format, so one function handles all four — only the base URL and default
// model actually differ between them. A user can override the base URL per
// key (see AiKey.baseUrl) for workspace-specific or self-hosted endpoints.
const OPENAI_COMPATIBLE_BASE_URL: Record<"openai" | "deepseek" | "kimi" | "qwen", string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  kimi: "https://api.moonshot.cn/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

export type UserAiConfig = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  /** Only meaningful for OPENAI_COMPATIBLE_PROVIDERS; overrides the default base URL above. */
  baseUrl?: string;
};

/**
 * Decrypts and returns the key for one specific provider, regardless of
 * which provider is the user's default. File-reading features (JD parsing,
 * resume check, resume match) always want "gemini" here specifically, since
 * only Gemini's API can read a PDF/image directly — the user's default
 * provider (e.g. DeepSeek) is irrelevant to that decision.
 */
export async function getUserAiKey(
  userId: string,
  provider: AiProviderId
): Promise<UserAiConfig | null> {
  const key = await db.aiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!key) return null;
  return {
    provider,
    apiKey: decryptSecret(key.apiKeyEncrypted),
    model: key.model || AI_PROVIDERS[provider].defaultModel,
    baseUrl: key.baseUrl ?? undefined,
  };
}

/** Decrypts and returns the user's default-provider AI config, or null if none is set. */
export async function getUserAiConfig(userId: string): Promise<UserAiConfig | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { defaultAiProvider: true },
  });
  if (!user?.defaultAiProvider) return null;
  return getUserAiKey(userId, user.defaultAiProvider as AiProviderId);
}

/**
 * Strips a ```json ... ``` fence if the model wrapped its answer in one —
 * only Gemini's responseSchema mode guarantees bare JSON; every other
 * provider here is prompted for JSON but not schema-constrained, so this is
 * the one normalization point instead of repeating it at every call site.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    console.error("[extractJson] unparseable, length:", raw.length, "tail:", raw.slice(-300));
    throw new UserFacingError("AI 返回格式异常，请重试");
  }
}

async function callOpenAiCompatible(
  provider: "openai" | "deepseek" | "kimi" | "qwen",
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number,
  baseUrlOverride?: string
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrlOverride || OPENAI_COMPATIBLE_BASE_URL[provider]}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // `prompt` here is already schema-annotated by withSchemaReminder(),
        // which also satisfies OpenAI-compatible APIs' (confirmed on
        // DeepSeek, same documented behavior on OpenAI) requirement that the
        // literal word "json" appear somewhere in the prompt to use
        // response_format: json_object.
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        // Without this, DeepSeek/OpenAI/Kimi/Qwen fall back to their own
        // (commonly 4096-token) default — a multi-question interview Q&A
        // generation (6-8 items, each with a full reference answer) can run
        // right up against that and get cut off mid-JSON, which then fails
        // to parse and surfaces as a confusing "AI 返回格式异常" instead of
        // the truncation it actually was.
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
    console.error(`[${provider}] ${response.status}`, detail.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new UserFacingError("API Key 无效，请检查账号设置里的 AI 配置");
    }
    if (response.status === 429) {
      throw new UserFacingError("API 调用超限，请稍后重试");
    }
    throw new UserFacingError("AI 服务暂时不可用，请稍后重试");
  }

  const data = await response.json();
  if (data?.choices?.[0]?.finish_reason === "length") {
    throw new UserFacingError("AI 回答内容太长被截断了，请重试（有时候换一次就好）");
  }
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  return extractJson(text);
}

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<unknown> {
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
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        // Same reasoning as OPENAI_COMPATIBLE's max_tokens: 8192 — a 6-8
        // question interview Q&A generation can plausibly exceed 4096 and
        // get cut off mid-JSON.
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: `${prompt}\n\n只返回一个 JSON 对象，不要用 markdown 代码块包裹，不要有任何其他文字。`,
          },
        ],
      }),
    });
  } catch {
    throw new UserFacingError("AI 请求超时，请稍后重试");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[anthropic] ${response.status}`, detail.slice(0, 500));
    if (response.status === 401) {
      throw new UserFacingError("API Key 无效，请检查账号设置里的 AI 配置");
    }
    if (response.status === 429) {
      throw new UserFacingError("API 调用超限，请稍后重试");
    }
    throw new UserFacingError("AI 服务暂时不可用，请稍后重试");
  }

  const data = await response.json();
  if (data?.stop_reason === "max_tokens") {
    throw new UserFacingError("AI 回答内容太长被截断了，请重试（有时候换一次就好）");
  }
  const text: string = data?.content?.[0]?.text ?? "";
  return extractJson(text);
}

/**
 * Text-only structured-JSON call (no file input) that goes through whichever
 * provider `config` names. Used by features that only need JD text + a
 * resume summary as context (interview prep, mock interview questions) —
 * not the file-reading features, since only Gemini's inlineData path here
 * can read a PDF directly.
 */
export async function callTextAi({
  config,
  prompt,
  schema,
  thinkingBudget = 1024,
  timeoutMs = 60000,
}: {
  config: UserAiConfig | null;
  prompt: string;
  /** Only enforced when falling back to shared Gemini (schema-constrained). */
  schema: GeminiSchema;
  thinkingBudget?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  if (!config) {
    return generateStructured({ prompt, schema, thinkingBudget, timeoutMs });
  }

  switch (config.provider) {
    case "gemini":
      return generateStructured({
        prompt,
        schema,
        thinkingBudget,
        timeoutMs,
        apiKey: config.apiKey,
        model: config.model,
      });
    case "openai":
    case "deepseek":
    case "kimi":
    case "qwen":
      return callOpenAiCompatible(
        config.provider,
        config.apiKey,
        config.model,
        withSchemaReminder(prompt, schema),
        timeoutMs,
        config.baseUrl
      );
    case "anthropic":
      return callAnthropic(
        config.apiKey,
        config.model,
        withSchemaReminder(prompt, schema),
        timeoutMs
      );
  }
}

/**
 * Only Gemini gets `schema` passed as an actual enforced responseSchema —
 * every other provider here only sees it if it's in the prompt text. Without
 * this, a prompt that never spells out a field's exact key name in Chinese
 * (e.g. "companyName") gets that key silently omitted by the model instead
 * of filled with null, because the model has no other way to learn it's
 * expected — caught via a real DeepSeek call dropping companyName/title.
 */
export function withSchemaReminder(prompt: string, schema: GeminiSchema): string {
  return `${prompt}\n\n严格按下面这个 TypeScript 类型输出一个 JSON 对象（这只是字段类型说明，不要把 type/properties 这些词当成真正要输出的 key，直接输出符合这个类型的值本身）。必须包含全部字段（不确定的字段填 null，不要省略 key，不要用 markdown 代码块包裹，不要有 JSON 之外的任何文字）：\n${schemaToTypeHint(schema)}`;
}

/**
 * Turns a Gemini-dialect schema ({type:"OBJECT", properties:{...}}) into a
 * TypeScript-interface-shaped string instead of dumping the raw schema JSON
 * into the prompt. Dumping it raw is what caused this bug in the first
 * place: a nested schema literally uses "type"/"properties" as JSON keys,
 * and a model reading that inside a "here's the JSON you must produce"
 * instruction can mistake the schema's own wrapper shape for the literal
 * output — caught via a real DeepSeek call on interview-qa's nested
 * questions[] schema, which came back as
 * `{"type":"OBJECT","properties":{"summary":"...","questions":[...]}}`
 * instead of `{"summary":"...","questions":[...]}`. A type-hint string has
 * no such collision — there's nothing in it that looks like a JSON value to
 * mirror.
 */
function schemaToTypeHint(schema: GeminiSchema, indent = ""): string {
  const type = schema.type as string | undefined;
  const nullable = schema.nullable === true;
  const suffix = nullable ? " | null" : "";

  if (type === "OBJECT") {
    const properties = (schema.properties as Record<string, GeminiSchema>) ?? {};
    const nextIndent = indent + "  ";
    const fields = Object.entries(properties)
      .map(([key, value]) => `${nextIndent}${key}: ${schemaToTypeHint(value, nextIndent)}`)
      .join(",\n");
    return `{\n${fields}\n${indent}}${suffix}`;
  }
  if (type === "ARRAY") {
    const items = (schema.items as GeminiSchema) ?? { type: "STRING" };
    return `Array<${schemaToTypeHint(items, indent)}>${suffix}`;
  }
  if (type === "STRING") {
    const enumValues = schema.enum as string[] | undefined;
    if (enumValues?.length) return `${enumValues.map((v) => `"${v}"`).join(" | ")}${suffix}`;
    return `string${suffix}`;
  }
  if (type === "NUMBER") return `number${suffix}`;
  if (type === "BOOLEAN") return `boolean${suffix}`;
  return `unknown${suffix}`;
}

export { GeminiError };
