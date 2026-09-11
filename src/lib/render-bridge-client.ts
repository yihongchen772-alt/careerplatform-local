/**
 * Asks the Electron main process — which alone has BrowserWindow access —
 * to load `url` in a hidden window and return its rendered visible text.
 * Only available inside the desktop app: electron/main.js sets
 * CAREERPLATFORM_RENDER_BRIDGE_URL/_TOKEN as env vars on the Next.js child
 * process it spawns. Running this server any other way (`next dev` directly,
 * tests) leaves those unset, so this always throws there.
 */

const RENDER_TIMEOUT_MS = 25000;

/**
 * `useApplicationSession` renders inside the 网申浏览器's own cookie jar
 * (persist:job-application-browser) instead of a blank one — the only way
 * to read a page that's behind the login the user did in that panel.
 */
export async function renderPageText(
  url: string,
  options: { useApplicationSession?: boolean } = {}
): Promise<string> {
  const bridgeUrl = process.env.CAREERPLATFORM_RENDER_BRIDGE_URL;
  const token = process.env.CAREERPLATFORM_RENDER_BRIDGE_TOKEN;
  if (!bridgeUrl || !token) {
    throw new Error("渲染桥接不可用（当前不在桌面 App 环境中运行）");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const res = await fetch(`${bridgeUrl}/render`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        url,
        ...(options.useApplicationSession ? { partition: "persist:job-application-browser" } : {}),
      }),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : `渲染失败：HTTP ${res.status}`;
      throw new Error(message);
    }
    const text = data && typeof data === "object" && "text" in data ? (data as { text: unknown }).text : "";
    return typeof text === "string" ? text : "";
  } finally {
    clearTimeout(timer);
  }
}

export type WhisperSegment = { from: number; to: number; text: string };

function bridgeEnv() {
  const bridgeUrl = process.env.CAREERPLATFORM_RENDER_BRIDGE_URL;
  const token = process.env.CAREERPLATFORM_RENDER_BRIDGE_TOKEN;
  if (!bridgeUrl || !token) return null;
  return { bridgeUrl, token };
}

/** Whether the desktop app can transcribe locally right now (binary + a downloaded model). */
export async function localWhisperReady(): Promise<boolean> {
  const env = bridgeEnv();
  if (!env) return false;
  try {
    const res = await fetch(`${env.bridgeUrl}/whisper/status`, {
      headers: { Authorization: `Bearer ${env.token}` },
    });
    if (!res.ok) return false;
    const status = (await res.json()) as { binaryAvailable?: boolean; activeModel?: string | null };
    return !!status.binaryAvailable && !!status.activeModel;
  } catch {
    return false;
  }
}

/**
 * Runs whisper.cpp in the main process on a 16 kHz mono WAV the Next server
 * wrote under its uploads dir. No timeout on purpose: a 5-minute chunk on a
 * slow laptop with the medium model can legitimately take several minutes.
 */
export async function transcribeWithLocalWhisper(
  file: string
): Promise<{ model: string; segments: WhisperSegment[]; elapsedMs: number }> {
  const env = bridgeEnv();
  if (!env) throw new Error("本地转写只在桌面 App 里可用");
  const res = await fetch(`${env.bridgeUrl}/whisper/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.token}` },
    body: JSON.stringify({ file }),
  });
  const data = (await res.json().catch(() => null)) as
    | { error?: string; model?: string; segments?: WhisperSegment[]; elapsedMs?: number }
    | null;
  if (!res.ok || !data || !data.segments) throw new Error(data?.error || `本地转写失败：HTTP ${res.status}`);
  return { model: data.model ?? "", segments: data.segments, elapsedMs: data.elapsedMs ?? 0 };
}
