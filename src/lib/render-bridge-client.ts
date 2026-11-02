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
  options: { useApplicationSession?: boolean; useSearchSession?: boolean } = {}
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
        ...(options.useApplicationSession ? { partition: "persist:job-application-browser" } : options.useSearchSession ? { partition: "cp-search" } : {}),
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

export type SheetRows = { name: string; columns: string[]; rows: { id: string; cells: Record<string, string> }[] };

/**
 * Every row of a shared 飞书多维表格, read by the Electron main process in a
 * hidden window of its own (electron/feishu-base.js). A big sheet (10k+ rows)
 * takes some seconds, hence the longer wait.
 */
export async function readFeishuBase(url: string): Promise<SheetRows> {
  const bridgeUrl = process.env.CAREERPLATFORM_RENDER_BRIDGE_URL;
  const token = process.env.CAREERPLATFORM_RENDER_BRIDGE_TOKEN;
  if (!bridgeUrl || !token) throw new Error("读取飞书表格需要在桌面 App 里运行");
  const res = await fetch(`${bridgeUrl}/feishu-base`, {
    method: "POST",
    signal: AbortSignal.timeout(180000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json().catch(() => null)) as (SheetRows & { error?: string }) | null;
  if (!res.ok || !data || !Array.isArray(data.rows)) throw new Error(data?.error || `读取飞书表格失败：HTTP ${res.status}`);
  return data;
}
