/**
 * Runs once when the Next server process starts, before any request is
 * handled — the one place to apply a saved proxy setting before the first
 * AI call goes out. See src/lib/proxy-agent.ts for why this is needed at
 * all: plain fetch() in this process doesn't inherit the OS/Electron proxy.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getAppSettings } = await import("@/lib/actions/app-settings");
  const { applyProxy } = await import("@/lib/proxy-agent");
  const settings = await getAppSettings();
  applyProxy(settings.proxyUrl);
}
