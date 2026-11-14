import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { applyProxy } from "@/lib/proxy-agent";
import { BUILT_IN_BOARDS, runBoards, type BoardJob } from "@/lib/career-ops";
import type { PostingFields } from "@/lib/campus-sheet";

export const BUILTIN_FEED_URL = "builtin://official-feed";
export const BUILTIN_FEED_NAME = "内置名企官网每日直招池";

export const CLOUD_FEED_TAG = "postings-feed";
export const CLOUD_FEED_META_URL =
  process.env.CAREERPLATFORM_FEED_META_URL ||
  `https://github.com/yihongchen772-alt/careerplatform-local/releases/download/${CLOUD_FEED_TAG}/postings-feed-meta.json`;
export const CLOUD_FEED_GZ_URL =
  process.env.CAREERPLATFORM_FEED_GZ_URL ||
  `https://github.com/yihongchen772-alt/careerplatform-local/releases/download/${CLOUD_FEED_TAG}/postings-feed.json.gz`;

export type SerializedFeedPosting = {
  externalId: string;
  company: string;
  roles: string | null;
  cohort: string | null;
  kind: string | null;
  cities: string | null;
  industry: string | null;
  degree: string | null;
  writtenTest: string | null;
  applyUrl: string | null;
  noticeUrl: string | null;
  startDate: string | null;
  deadline: string | null;
  deadlineText: string | null;
  note: string | null;
  salary: string | null;
};

export type CloudFeedPayload = {
  version: number;
  rev: number;
  generatedAt: string;
  name?: string;
  total: number;
  items: SerializedFeedPosting[];
};

export function isBuiltinFeedUrl(url: string | null | undefined): boolean {
  return url === BUILTIN_FEED_URL;
}

const OVERSEAS_LOCATION_RE =
  /^(?:新加坡|东京|大阪|首尔|西雅图|圣何塞|山景城|旧金山|纽约|洛杉矶|奥斯汀|波士顿|芝加哥|多伦多|温哥华|伦敦|都柏林|阿姆斯特丹|慕尼黑|柏林|法兰克福|巴黎|苏黎世|华沙|斯德哥尔摩|马德里|米兰|迪拜|利雅得|开罗|雅加达|吉隆坡|曼谷|胡志明市?|河内|马尼拉|悉尼|墨尔本|孟买|班加罗尔|新德里|墨西哥城?|圣保罗|布宜诺斯艾利斯|圣地亚哥|Singapore|Tokyo|Osaka|Seoul|Seattle|San\s*Jose|Mountain\s*View|San\s*Francisco|New\s*York|Los\s*Angeles|Austin|Boston|Toronto|Vancouver|London|Dublin|Amsterdam|Munich|Berlin|Paris|Warsaw|Dubai|Jakarta|Kuala\s*Lumpur|Bangkok|Ho\s*Chi\s*Minh|Manila|Sydney|Melbourne|Mumbai|Bangalore|Bengaluru|Mexico|Sao\s*Paulo|US|USA|UK|Germany|Japan|Korea|India|Indonesia|Thailand|Vietnam|Malaysia|Philippines|Australia|Brazil|Canada|France)$/i;

const DOMESTIC_CITY_IN_TITLE_RE =
  /(?:[（(【\-\s·/]|^)(北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|合肥|重庆|长沙|郑州|天津|青岛|厦门|无锡|宁波|珠海|东莞|佛山|福州|济南|大连|沈阳|哈尔滨|长春|南昌|石家庄|太原|昆明|贵阳|南宁|海口|兰州|香港|澳门)(?:市|[）)】\-\s·/]|$)/;

function cleanCities(location: string | null | undefined, title = ""): { cities: string | null; overseasOnly: boolean } {
  const rawParts = (location || "")
    .replace(/中国[-/·]?/g, "")
    .split(/[/,，、;|]+/)
    .map((s) => s.trim().replace(/^(?:中国|大陆)[-·\s]*/, "").replace(/市$/, "").replace(/总部$/, ""))
    .filter((s) => s && s.length <= 24 && !/^(远程|不限|全國|全国)$/i.test(s));

  const domesticParts = rawParts.filter((s) => !OVERSEAS_LOCATION_RE.test(s));
  if (rawParts.length > 0 && domesticParts.length === 0) {
    return { cities: null, overseasOnly: true };
  }
  if (domesticParts.length === 0 && title) {
    const m = DOMESTIC_CITY_IN_TITLE_RE.exec(title);
    if (m?.[1]) domesticParts.push(m[1]);
  }
  const unique = [...new Set(domesticParts)].slice(0, 8);
  return { cities: unique.length ? unique.join("、") : null, overseasOnly: false };
}

function inferKind(title: string, description: string, careersUrl = ""): string {
  const text = `${title} ${description.slice(0, 400)}`;
  if (/暑期实习|summer\s*intern/i.test(text)) return "暑期实习";
  if (/实习|intern/i.test(text)) return "实习";
  if (/提前批/.test(text)) return "秋招提前批";
  if (/补录/.test(text)) return "秋招补录";
  if (/春招|春季校园/.test(text)) return "春招";
  if (/人才计划|天才少年|青云|筋斗云|北斗|星火|未来星|管培生/.test(text)) return "人才计划";
  if (
    /校招|校园招聘|应届|毕业生|campus|\d{2,4}\s*届/i.test(text) ||
    /(?:\/campus\b|campus-recruitment|join\.qq\.com)/i.test(careersUrl)
  ) {
    return "秋招";
  }
  return "社招";
}

function inferCohort(title: string, description: string): string | null {
  const text = `${title} ${description.slice(0, 400)}`;
  const matches = text.match(/202[5-9]\s*届|\b2[5-9]\s*届/g);
  if (!matches || !matches.length) return null;
  const normalized = [
    ...new Set(
      matches.map((m) => {
        const digits = m.replace(/\D+/g, "");
        return digits.length === 2 ? `20${digits}届` : `${digits}届`;
      })
    ),
  ];
  return normalized.join("、");
}

function inferDegree(description: string): string | null {
  const head = description.slice(0, 600);
  if (/博士及以上|博士学历/.test(head)) return "博士";
  if (/硕士及以上|研究生及以上|硕士学历/.test(head)) return "硕士及以上";
  if (/本科及以上|本科学历|统招本科|bachelor/i.test(head)) return "本科及以上";
  return null;
}

export function boardJobToPostingFields(
  job: BoardJob,
  meta?: { industry?: string; careers_url?: string },
  now = new Date()
): PostingFields | null {
  const company = (job.company || "").replace(/(?:校招|校园招聘|社招)$/, "").trim().slice(0, 120);
  const title = (job.title || "").trim().slice(0, 200);
  const url = (job.url || "").trim();
  if (!company || !title || !/^https?:\/\//i.test(url)) return null;

  const hash = createHash("sha1").update(url).digest("hex").slice(0, 20);
  const desc = (job.description || "").trim();
  if (/第三方派遣|Third-party Associate/i.test(`${title} ${desc}`)) return null;
  const { cities, overseasOnly } = cleanCities(job.location, title);
  if (overseasOnly) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let startDate = today;
  if (typeof job.postedAt === "number" && Number.isFinite(job.postedAt) && job.postedAt > 0) {
    const d = new Date(job.postedAt);
    if (!Number.isNaN(d.getTime()) && d <= now && d.getFullYear() >= 2023) {
      startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }

  return {
    externalId: `feed:${hash}`,
    company,
    roles: title,
    cohort: inferCohort(title, desc),
    kind: inferKind(title, desc, meta?.careers_url),
    cities,
    industry: meta?.industry ?? "互联网/科技",
    degree: inferDegree(desc),
    writtenTest: null,
    applyUrl: url,
    noticeUrl: null,
    startDate,
    deadline: null,
    deadlineText: "招满即止",
    note: desc ? desc.replace(/\s+/g, " ").slice(0, 500) : null,
    salary: null,
  };
}

export function deserializeFeedPosting(item: SerializedFeedPosting, now = new Date()): PostingFields | null {
  if (!item || !item.company || !item.externalId) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const parseDay = (iso: string | null | undefined): Date | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return {
    externalId: String(item.externalId).slice(0, 80),
    company: String(item.company).slice(0, 120),
    roles: item.roles ? String(item.roles).slice(0, 2000) : null,
    cohort: item.cohort ? String(item.cohort).slice(0, 120) : null,
    kind: item.kind ? String(item.kind).slice(0, 120) : null,
    cities: item.cities ? String(item.cities).slice(0, 240) : null,
    industry: item.industry ? String(item.industry).slice(0, 120) : null,
    degree: item.degree ? String(item.degree).slice(0, 60) : null,
    writtenTest: item.writtenTest ? String(item.writtenTest).slice(0, 60) : null,
    applyUrl: item.applyUrl ? String(item.applyUrl).slice(0, 1000) : null,
    noticeUrl: item.noticeUrl ? String(item.noticeUrl).slice(0, 1000) : null,
    startDate: parseDay(item.startDate) ?? today,
    deadline: parseDay(item.deadline),
    deadlineText: item.deadlineText ? String(item.deadlineText).slice(0, 120) : null,
    note: item.note ? String(item.note).slice(0, 1000) : null,
    salary: item.salary ? String(item.salary).slice(0, 120) : null,
  };
}

/**
 * Checks the lightweight cloud feed metadata (~100 bytes) to see if a newer
 * daily snapshot is available without downloading the full gzip archive.
 */
export async function builtinFeedRevision(): Promise<number | null> {
  try {
    applyProxy(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null);
    const res = await fetch(CLOUD_FEED_META_URL, {
      headers: { Accept: "application/json", "User-Agent": "JobCompass-Desktop" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { rev?: unknown } | null;
    return typeof data?.rev === "number" && Number.isFinite(data.rev) ? data.rev : null;
  } catch {
    return null;
  }
}

/**
 * Reads the daily postings feed:
 * 1. Tries downloading the pre-aggregated GitHub Actions `postings-feed.json.gz` mirror (~1s).
 * 2. Falls back to running local `career-ops` board fetchers directly if cloud mirror is unreachable.
 */
export async function readBuiltinFeed(now = new Date()): Promise<{
  name: string;
  rev: number | null;
  postings: PostingFields[];
  mode: "cloud" | "local";
}> {
  try {
    applyProxy(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null);
    const res = await fetch(CLOUD_FEED_GZ_URL, {
      headers: { Accept: "application/octet-stream, application/json", "User-Agent": "JobCompass-Desktop" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const rawText = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
      const payload = JSON.parse(rawText) as CloudFeedPayload;
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        const postings = payload.items
          .map((item) => deserializeFeedPosting(item, now))
          .filter((item): item is PostingFields => item !== null);
        if (postings.length > 0) {
          return {
            name: BUILTIN_FEED_NAME,
            rev: typeof payload.rev === "number" ? payload.rev : Math.floor(now.getTime() / 1000),
            postings,
            mode: "cloud",
          };
        }
      }
    }
  } catch {
    // Fall through to local live board fetch
  }

  const metaByName = new Map(BUILT_IN_BOARDS.map((b) => [b.name, b]));
  const boardResults = await runBoards(
    BUILT_IN_BOARDS.map((b) => ({ name: b.name, careers_url: b.careers_url, keywords: [] })),
    45000
  );
  const seen = new Map<string, PostingFields>();
  for (const result of boardResults) {
    const meta = metaByName.get(result.name);
    for (const job of result.jobs || []) {
      const fields = boardJobToPostingFields({ ...job, company: job.company || result.name }, meta, now);
      if (fields && !seen.has(fields.externalId)) {
        seen.set(fields.externalId, fields);
      }
    }
  }
  const postings = [...seen.values()];
  if (!postings.length) {
    throw new Error("云端岗位镜像与官网直招通道均暂时无法连接，请检查网络后重试");
  }
  return {
    name: BUILTIN_FEED_NAME,
    rev: Math.floor(now.getTime() / 1000),
    postings,
    mode: "local",
  };
}
