import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";

/**
 * Node's global fetch() (undici under the hood) does not inherit whatever
 * system proxy or VPN the OS/Electron has configured — a browser tab or the
 * app's own window would go through it, but this server-side fetch quietly
 * dials out directly and, on a network that needs a proxy to reach
 * Gemini/OpenAI/Anthropic at all, just hangs until timeout. Swapping the
 * global dispatcher is a one-line fix that covers every fetch() call in this
 * process without threading a proxy option through each of them individually.
 *
 * Idempotent against the same URL so this can be called both at server
 * startup (see instrumentation.ts) and again every time the setting is
 * saved, without tearing down and rebuilding a working connection pool for
 * no reason.
 */
let appliedProxyUrl: string | undefined;

export function applyProxy(proxyUrl: string | undefined | null): void {
  const trimmed = proxyUrl?.trim() || undefined;
  if (trimmed === appliedProxyUrl) return;
  appliedProxyUrl = trimmed;
  setGlobalDispatcher(trimmed ? new ProxyAgent(trimmed) : new Agent());
}
