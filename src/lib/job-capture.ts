export function normalizeJobUrl(value?: string | null) {
  if (!value?.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    // Preserve hashes: many recruiting sites put the job ID in a SPA fragment.
    for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|gclid|fbclid)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return null; }
}
export function normalizeJobName(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[\s·•]/g, ""); }
export function isPublicAddress(address: string) {
  if (address.includes(":")) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}
