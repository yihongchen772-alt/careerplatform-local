import { UserFacingError } from "@/lib/action-result";
import { readLocalFile } from "@/lib/local-storage";

// Free-tier quota is per-model per-day, and 3.6-flash only allows 20 calls —
// enough to exhaust in one afternoon of testing. flash-lite has its own,
// larger allowance and still reads PDF resumes accurately.
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

export type GeminiFilePart = {
  mimeType: string;
  /** base64, no data: prefix */
  data: string;
};

/** Minimal shape of the OpenAPI-ish schema Gemini expects for structured output. */
export type GeminiSchema = Record<string, unknown>;

export class GeminiError extends UserFacingError {}

/**
 * One structured-output call. Callers pass a response schema and get parsed JSON
 * back; validation against a zod schema stays with the caller.
 *
 * `thinkingBudget` matters a lot here: leaving Gemini's default on made JD
 * parsing ~10x slower (11s vs 1.2s) for identical output. Extraction wants a
 * small budget, judgement tasks want more.
 */
export async function generateStructured({
  prompt,
  file,
  schema,
  thinkingBudget,
  timeoutMs = 60000,
  apiKey: apiKeyOverride,
  model: modelOverride,
}: {
  prompt: string;
  file?: GeminiFilePart;
  schema: GeminiSchema;
  thinkingBudget: number;
  timeoutMs?: number;
  /** BYOK: caller's own Gemini key/model, in preference to the shared one. */
  apiKey?: string;
  model?: string;
}): Promise<unknown> {
  const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("尚未配置 Gemini API Key，请先在账号设置里填一个");
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelOverride ?? MODEL}:generateContent`;

  const parts: Record<string, unknown>[] = [];
  if (file) parts.push({ inlineData: file });
  parts.push({ text: prompt });

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget },
          responseSchema: schema,
        },
      }),
    });
    clearTimeout(timeout);
  } catch {
    throw new GeminiError("AI 请求超时，请稍后重试");
  }

  if (!response.ok) {
    // Collapsing every status into one message hid a plain quota exhaustion as
    // "请稍后重试" — advice that would never have worked, since the free tier
    // resets daily rather than in minutes.
    const detail = await response.text().catch(() => "");
    console.error(`[gemini] ${response.status}`, detail.slice(0, 500));

    if (response.status === 429) {
      throw new GeminiError("今日 AI 免费额度已用完，明天恢复");
    }
    if (response.status === 400 || response.status === 403) {
      throw new GeminiError("AI 密钥无效或已过期，请到账号设置里更新");
    }
    throw new GeminiError("AI 服务暂时不可用，请稍后重试");
  }

  const data = await response.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError("AI 返回格式异常，请重试");
  }
}

const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

/**
 * Reads an uploaded resume into a Gemini inline part. Local build stores
 * files on disk under /api/files/<name> — that's a relative path, not a
 * fetchable URL from server-side code, so this reads straight off disk
 * instead of doing a self-referential HTTP round trip.
 */
export async function fetchFileAsInlinePart(
  url: string
): Promise<GeminiFilePart> {
  const filename = url.split("/").pop() ?? "";
  const file = await readLocalFile(filename);
  // Missing file means the DB row outlived the file on disk — retrying never
  // fixes that, so say what actually works instead.
  if (!file) {
    throw new GeminiError("简历文件已丢失，请重新上传这份简历后再试");
  }
  if (!ALLOWED_MIME.includes(file.mimeType)) {
    throw new GeminiError("只支持 PDF 或图片格式的简历");
  }

  return { mimeType: file.mimeType, data: file.buffer.toString("base64") };
}
