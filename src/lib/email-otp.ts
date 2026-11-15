import type { InboxEmail } from "@/lib/imap";

export type OtpCandidate = {
  code: string;
  subject: string;
  from: string;
  accountLabel?: string;
  receivedAt: string;
  matchedSite: boolean;
  score: number;
};

const OTP_CUE =
  /验证码|动态码|校验码|一次性密码|登录码|安全码|邮箱验证|verification\s*code|verify\s*code|one-?time\s*(?:password|passcode|code)|\botp\b|passcode|security\s*code|auth(?:entication)?\s*code|confirm(?:ation)?\s*code/i;
const GRAPHIC_ONLY_NOISE = /^(?=.*图形验证码)(?!.*(?:邮箱|邮件|email|otp|动态码))/i;
const PHONE_LIKE = /^1[3-9]\d{9}$/;

function isLikelyYear(token: string, contextAround: string): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const n = Number(token);
  if (n < 2018 || n > 2035) return false;
  // Treat 4-digit year as a real OTP only when explicitly marked right beside code cue, not "2026届/年"
  return /[年届\-\/]/.test(contextAround) || !/(?:验证码|动态码|校验码|code|otp)/i.test(contextAround.slice(0, 24));
}

function siteTokensFromHint(opts?: { url?: string | null; companyName?: string | null; title?: string | null }): string[] {
  const tokens = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const clean = String(raw || "").trim().toLowerCase();
    if (clean.length >= 2) tokens.add(clean);
  };
  if (opts?.companyName) {
    add(opts.companyName);
    for (const part of opts.companyName.split(/[\s·\-_/(),（）]+/)) add(part);
  }
  if (opts?.url) {
    try {
      const parsed = new URL(opts.url);
      for (const seg of parsed.hostname.split(".")) {
        if (!/^(?:www|app|jobs?|campus|join|career|careers|hr|hire|zhaopin|com|cn|net|org|io|co|vip)$/i.test(seg)) {
          add(seg);
        }
      }
      for (const seg of parsed.pathname.split("/")) {
        if (seg.length >= 3 && !/^(?:campus|apply|campus_apply|campus-recruitment|position|jobs?|login|signin|index|portal)$/i.test(seg)) {
          add(seg);
        }
      }
    } catch {
      // Ignore malformed URLs.
    }
  }
  if (opts?.title) {
    for (const part of opts.title.split(/[\s·\-_|/(),（）]+/)) {
      if (part.length >= 2 && !/^(?:登录|注册|网申|校招|招聘|campus|login|sign)$/i.test(part)) add(part);
    }
  }
  return [...tokens].slice(0, 12);
}

function cleanOtpMatches(haystack: string): string | null {
  // 1. Tightly bound after an explicit OTP cue word (supports digits or mixed alphanumeric like 4A9B2C)
  const tightRe =
    /(?:验证码|动态码|校验码|登录码|安全码|一次性密码|verification\s*code|verify\s*code|one-?time\s*(?:password|passcode|code)|passcode|\botp\b|\bcode\b)\s*(?:是|为|is|[:：])*\s*[【\[「"]?\s*([0-9]{4,8}|(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,8})\b/gi;
  for (const m of haystack.matchAll(tightRe)) {
    const token = m[1];
    if (!token || PHONE_LIKE.test(token)) continue;
    const around = haystack.slice(Math.max(0, (m.index ?? 0) - 12), (m.index ?? 0) + m[0].length + 12);
    if (isLikelyYear(token, around)) continue;
    return token;
  }

  // 2. Spaced 4-6 digit code right after cue (e.g. "验证码：1 2 3 4 5 6")
  const spacedRe = /(?:验证码|动态码|校验码|code|otp)\s*(?:是|为|is|[:：])*\s*([0-9](?:\s+[0-9]){3,7})\b/gi;
  for (const m of haystack.matchAll(spacedRe)) {
    const collapsed = m[1].replace(/\s+/g, "");
    if (collapsed.length >= 4 && collapsed.length <= 8) return collapsed;
  }

  // 3. Fallback: standalone 4-8 digits within +/- 60 chars of any OTP cue word
  for (const cue of haystack.matchAll(new RegExp(OTP_CUE.source, "gi"))) {
    const start = Math.max(0, (cue.index ?? 0) - 40);
    const end = Math.min(haystack.length, (cue.index ?? 0) + cue[0].length + 70);
    const windowText = haystack.slice(start, end);
    for (const num of windowText.matchAll(/(?<![0-9A-Za-z:：/.-])(\d{4,8})(?![0-9A-Za-z:：/.-])/g)) {
      const token = num[1];
      if (!token || PHONE_LIKE.test(token)) continue;
      const around = windowText.slice(Math.max(0, (num.index ?? 0) - 10), (num.index ?? 0) + token.length + 10);
      if (isLikelyYear(token, around)) continue;
      return token;
    }
  }
  return null;
}

export function extractOtpFromEmail(
  email: Pick<InboxEmail, "subject" | "from" | "date" | "snippet"> & { accountLabel?: string },
  options?: { url?: string | null; companyName?: string | null; title?: string | null; now?: number; maxAgeMs?: number }
): OtpCandidate | null {
  const now = options?.now ?? Date.now();
  const maxAgeMs = options?.maxAgeMs ?? 15 * 60_000;
  const ageMs = now - email.date.getTime();
  if (ageMs > maxAgeMs || ageMs < -2 * 60_000) return null;

  const subject = String(email.subject || "").trim();
  const snippet = String(email.snippet || "").replace(/\s+/g, " ").trim();
  const combined = `${subject}\n${snippet.slice(0, 2000)}`;
  if (!OTP_CUE.test(combined) || GRAPHIC_ONLY_NOISE.test(combined)) return null;

  const code = cleanOtpMatches(combined);
  if (!code) return null;

  const metaHaystack = `${email.from} ${subject} ${snippet.slice(0, 600)}`.toLowerCase();
  const tokens = siteTokensFromHint(options);
  const matchedSite = tokens.some((tok) => metaHaystack.includes(tok));
  const recencyBonus = Math.max(0, 10 - Math.floor(Math.max(0, ageMs) / 60_000));
  const emailKeywordBonus = /邮箱|email|招聘|校招|talent|recruit|mokahr|beisen|feishu|zhiye|hotjob|dayee/i.test(metaHaystack) ? 3 : 0;
  const score = (matchedSite ? 20 : 0) + emailKeywordBonus + recencyBonus;

  return {
    code,
    subject: subject || "(无主题)",
    from: email.from || "未知发件人",
    ...(email.accountLabel ? { accountLabel: email.accountLabel } : {}),
    receivedAt: email.date.toISOString(),
    matchedSite,
    score,
  };
}

export function pickBestOtpCandidates(
  emails: Array<Pick<InboxEmail, "subject" | "from" | "date" | "snippet"> & { accountLabel?: string }>,
  options?: { url?: string | null; companyName?: string | null; title?: string | null; now?: number; maxAgeMs?: number }
): OtpCandidate[] {
  const byCode = new Map<string, OtpCandidate>();
  for (const email of emails) {
    const candidate = extractOtpFromEmail(email, options);
    if (!candidate) continue;
    const prev = byCode.get(candidate.code);
    if (!prev || candidate.score > prev.score || candidate.receivedAt > prev.receivedAt) {
      byCode.set(candidate.code, candidate);
    }
  }
  return [...byCode.values()]
    .sort((a, b) => b.score - a.score || b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, 5);
}
