/** The desktop app has no login: only its loopback HTTP origin may reach the
 * local Next server. This also rejects DNS-rebinding Host headers. */
export function isTrustedLocalRequest(headers: Headers): boolean {
  const host = headers.get("host");
  if (!host) return false;

  let expectedOrigin: string;
  try {
    const parsed = new URL(`http://${host}`);
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return false;
    expectedOrigin = parsed.origin;
  } catch {
    return false;
  }

  const origin = headers.get("origin");
  if (origin && origin !== expectedOrigin) return false;

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return true;
}

// The paired Chrome extension calls /api/extension/* from its own origin
// (chrome-extension://<32 letters a–p>; Edge uses the same scheme). Only those
// routes, only with a pairing-code header, and still only on a loopback Host;
// the routes themselves verify the code (src/lib/extension-auth.ts).
export function isExtensionApiRequest(pathname: string, headers: Headers): boolean {
  if (!pathname.startsWith("/api/extension/")) return false;
  const host = headers.get("host");
  try {
    const parsed = new URL(`http://${host}`);
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return false;
  } catch {
    return false;
  }
  const origin = headers.get("origin");
  if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return false;
  return !!headers.get("x-jobcompass-token");
}
