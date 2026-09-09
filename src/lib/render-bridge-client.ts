/**
 * Asks the Electron main process — which alone has BrowserWindow access —
 * to load `url` in a hidden window and return its rendered visible text.
 * Only available inside the desktop app: electron/main.js sets
 * CAREERPLATFORM_RENDER_BRIDGE_URL/_TOKEN as env vars on the Next.js child
 * process it spawns. Running this server any other way (`next dev` directly,
 * tests) leaves those unset, so this always throws there.
 */

const RENDER_TIMEOUT_MS = 25000;

export async function renderPageText(url: string): Promise<string> {
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
      body: JSON.stringify({ url }),
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
