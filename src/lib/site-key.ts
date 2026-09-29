// Plain module — shared by the browser page (server) and the embedded browser
// (client) to answer "which company's site is this?" from a URL alone.

// Recruiting platforms that host many employers on one domain. The employer is
// identified by the subdomain (kept whole) or by a path segment (below).
const TENANT_SUBDOMAIN_HOSTS = /(?:^|\.)(?:zhiye\.com|jobs\.feishu\.cn|feishu\.cn|wintalent\.cn|hotjob\.cn|dayee\.com|italent\.cn|mokahr\.com|myworkdayjobs\.com|greenhouse\.io|lever\.co)$/i;

// Job boards list every company — a URL there never identifies an employer.
const JOB_BOARD_HOSTS = /(?:^|\.)(?:zhipin\.com|liepin\.com|51job\.com|lagou\.com|zhaopin\.com|nowcoder\.com|shixiseng\.com|linkedin\.com|indeed\.com|bing\.com|baidu\.com|google\.com|xiaohongshu\.com|weixin\.qq\.com)$/i;

const SECOND_LEVEL = /^(?:com|net|org|gov|edu|co|ac)$/;

function registrableDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const take = SECOND_LEVEL.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-take).join(".");
}

/**
 * A stable key for "the same employer's site": careers.tencent.com and
 * join.tencent.com share one; two companies on app.mokahr.com don't.
 * Returns null for job boards and anything unparsable.
 */
export function siteKey(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (JOB_BOARD_HOSTS.test(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  // Moka: app.mokahr.com/{campus-recruitment|social-recruitment|apply|m}/{org}/…
  if (/(?:^|\.)mokahr\.com$/.test(host)) {
    const org = segments.find((segment, i) => i > 0 && !/^\d+$/.test(segment)) ?? segments[0];
    return org ? `mokahr.com/${org.toLowerCase()}` : null;
  }
  // 大易/hotjob: wecruit.hotjob.cn/SU{tenant}/…
  if (/(?:^|\.)hotjob\.cn$/.test(host) && segments[0]) return `hotjob.cn/${segments[0].toLowerCase()}`;
  if (/(?:^|\.)myworkdayjobs\.com$/.test(host) || /(?:^|\.)(?:greenhouse\.io|lever\.co)$/.test(host)) {
    return segments[0] ? `${host}/${segments[0].toLowerCase()}` : host;
  }
  if (TENANT_SUBDOMAIN_HOSTS.test(host)) return host;
  return registrableDomain(host);
}

// Wording of the candidate-center pages the 进度同步 reads ("我的投递").
const CANDIDATE_CENTER_TEXT = /我的投递|投递记录|投递进度|我的申请|申请记录|申请进度|应聘记录|应聘进度|我的职位申请|职位申请记录|my applications?|application status/i;
const CANDIDATE_CENTER_URL = /candidate|personal|my-?apply|myapplication|apply-?record|delivery|deliver|user-?center|usercenter|member|#\/(?:home|mine|me)\b/i;

/** True for a "我的投递 / 申请进度" style page — the page 进度同步 should watch. */
export function looksLikeCandidateCenter(url: string, title: string, text: string): boolean {
  const head = `${title}\n${text.slice(0, 4000)}`;
  const textHits = (head.match(new RegExp(CANDIDATE_CENTER_TEXT.source, "gi")) || []).length;
  // Wording alone can be a nav link on any page; wording plus a candidate-ish
  // URL, or the wording repeated (tab + heading), is the page itself.
  return textHits >= 2 || (textHits >= 1 && CANDIDATE_CENTER_URL.test(url));
}

export type KnownSite = {
  companyId: string;
  companyName: string;
  /** siteKey() of every URL known for this company. */
  keys: string[];
  /** siteKey() of its saved 进度页 — a candidate center there is already watched. */
  portalKeys: string[];
  applications: { id: string; title: string; stage: string; terminal: boolean }[];
};

export function matchKnownSite(sites: KnownSite[], url: string | null, title: string): KnownSite | null {
  const key = siteKey(url);
  if (key) {
    const byKey = sites.find((site) => site.keys.includes(key));
    if (byKey) return byKey;
  }
  // A first visit to a new ATS page (no URL recorded yet) still names the
  // employer in its title often enough to be worth a check.
  return sites.find((site) => site.companyName.length >= 2 && title.includes(site.companyName)) ?? null;
}
