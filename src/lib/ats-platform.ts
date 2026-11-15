export type AtsPlatformId = "" | "autofill" | "feishu" | "moka" | "beisen" | "dayee" | "majors" | "global";

export const ATS_PLATFORM_OPTIONS: {
  id: Exclude<AtsPlatformId, "">;
  label: string;
  description: string;
}[] = [
  { id: "autofill", label: "仅可一键填表", description: "飞书 / Moka / 北森 / 大易" },
  { id: "feishu", label: "飞书", description: "jobs.feishu.cn / 字节" },
  { id: "moka", label: "Moka", description: "app.mokahr.com" },
  { id: "beisen", label: "北森", description: "*.zhiye.com" },
  { id: "dayee", label: "大易", description: "*.hotjob.cn / *.dayee.com / 独立域名" },
  { id: "majors", label: "大厂直招", description: "腾讯 / 阿里 / 美团" },
  { id: "global", label: "外企ATS", description: "Greenhouse / Lever / Ashby" },
];

const PRIVATE_OR_LOCAL_HOST_RE =
  /^(?:localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/i;

/** Detects Dayee/HotJob portals including custom domains carrying `/SU<hex>/pb/` or `/wecruit/`. */
export function isDayeeUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const host = u.hostname.toLowerCase();
    if (PRIVATE_OR_LOCAL_HOST_RE.test(host)) return false;
    if (/(^|\.)(hotjob\.cn|dayee\.com)$/i.test(host)) return true;
    return /\/SU[a-f0-9]{16,40}(?:\/|$)/i.test(u.pathname) && /\/(?:pb|wecruit)\//i.test(u.pathname);
  } catch {
    return /hotjob\.cn|dayee\.com/i.test(rawUrl) || (/\/SU[a-f0-9]{16,40}\//i.test(rawUrl) && /\/(?:pb|wecruit)\//i.test(rawUrl));
  }
}

export function atsLabelForUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/mokahr\.com/i.test(url)) return "Moka";
  if (/zhiye\.com/i.test(url)) return "北森";
  if (/jobs\.feishu\.cn|jobs\.bytedance\.com/i.test(url)) return "飞书";
  if (isDayeeUrl(url)) return "大易";
  if (/careers\.tencent\.com|join\.qq\.com/i.test(url)) return "腾讯直招";
  if (/alibaba\.com|aliyun\.com/i.test(url)) return "阿里直招";
  if (/zhaopin\.meituan\.com/i.test(url)) return "美团直招";
  if (/greenhouse\.io|lever\.co|ashbyhq\.com/i.test(url)) return "外企ATS";
  return null;
}

export function isAutofillSupportedAts(label: string | null | undefined): boolean {
  return label === "飞书" || label === "Moka" || label === "北森" || label === "大易";
}
