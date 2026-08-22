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

// OpenAI, DeepSeek, and Kimi all speak the same /chat/completions wire format,
// so one function handles all three — only the base URL and default model
// actually differ between them.
const OPENAI_COMPATIBLE_BASE_URL: Record<"openai" | "deepseek" | "kimi", string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  kimi: "https://api.moonshot.cn/v1",
};

export type UserAiConfig = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
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
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new UserFacingError("AI 返回格式异常，请重试");
  }
}

async function callOpenAiCompatible(
  provider: "openai" | "deepseek" | "kimi",
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${OPENAI_COMPATIBLE_BASE_URL[provider]}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
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
        max_tokens: 4096,
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
      return callOpenAiCompatible(
        config.provider,
        config.apiKey,
        config.model,
        prompt,
        timeoutMs
      );
    case "anthropic":
      return callAnthropic(config.apiKey, config.model, prompt, timeoutMs);
  }
}

export { GeminiError };
