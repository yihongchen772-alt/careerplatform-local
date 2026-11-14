// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Beisen Zhiye (北森招聘门户 *.zhiye.com) provider.
// Supports both Beisen Phoenix JSON APIs (`/api/JobAd/GetJobAdPageList`) and
// classic SSR HTML job tables (`/jobs`, `/Campus`, `/Social`, `/zpdetail/*`).

import { MACOS_BROWSER_LIKE_USER_AGENT, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const PAGE_SIZE = 50;
const DEFAULT_KEYWORDS = [''];
const DEFAULT_MAX_PAGES = 5;
const INTER_PAGE_DELAY_MS = 300;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function resolveZhiyeOrigin(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (!url.hostname.endsWith('.zhiye.com') || url.hostname === 'www.zhiye.com') return null;
  return url.origin;
}

/**
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin
 * @returns {{ jobs: import('./_types.js').Job[], total: number }}
 */
export function parseZhiyeResponse(json, companyName, origin) {
  const container = json?.Data ?? json?.data ?? json;
  const list = Array.isArray(container)
    ? container
    : (container?.List ?? container?.Jobs ?? container?.Items ?? container?.jobList ?? container?.records ?? []);
  const total = Number(container?.Total ?? container?.TotalCount ?? container?.Count ?? json?.TotalCount ?? list?.length) || 0;
  if (!Array.isArray(list)) return { jobs: [], total: 0 };

  const jobs = [];
  for (const item of list) {
    const title = String(item?.JobAdName || item?.Title || item?.JobTitle || item?.name || item?.title || '').trim();
    const rawId = item?.Id ?? item?.JobAdId ?? item?.JobId ?? item?.id;
    if (!title || (rawId == null && !item?.JobAdUrl && !item?.Url)) continue;
    const encodedId = rawId != null ? safeEncodeURIComponent(String(rawId)) : null;
    const url = typeof item?.JobAdUrl === 'string' && /^https?:\/\//.test(item.JobAdUrl)
      ? item.JobAdUrl
      : typeof item?.Url === 'string' && /^https?:\/\//.test(item.Url)
        ? item.Url
        : encodedId
          ? `${origin}/jobs/detail/${encodedId}`
          : '';
    if (!url) continue;
    let location = Array.isArray(item?.LocNames)
      ? item.LocNames.filter(Boolean).join('/')
      : String(item?.LocNames || item?.CityName || item?.Location || item?.WorkPlace || item?.city || '').trim();
    if (!location) {
      const cityInTitle = title.match(/[（(](北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|合肥|重庆|长沙|郑州|天津|青岛|厦门|无锡|宁波|珠海|东莞|佛山|福州|济南|大连|沈阳|哈尔滨|长春|南昌|石家庄|太原|昆明|贵阳|南宁|海口|兰州)[市）)]/);
      if (cityInTitle) location = cityInTitle[1];
    }
    const rawDesc = [
      item?.CategoryName && `类别: ${item.CategoryName}`,
      item?.KindName && `类型: ${item.KindName}`,
      item?.Duty || item?.Description || item?.JobDuty,
      item?.Require || item?.Requirement || item?.Demand || item?.JobRequirement,
    ].filter(Boolean).join('\n');
    let postedAt;
    for (const candidate of [item?.ChangeDate, item?.ModifyTime, item?.PublishTime, item?.PostDate, item?.CreateTime]) {
      if (!candidate) continue;
      const ms = Date.parse(String(candidate));
      if (Number.isFinite(ms) && ms >= 946684800000) {
        postedAt = ms;
        break;
      }
    }
    jobs.push({
      title,
      url,
      company: companyName,
      location,
      description: htmlToText(rawDesc).slice(0, 3000),
      postedAt,
    });
  }
  return { jobs, total: Math.max(total, jobs.length) };
}

/**
 * Fallback parser for classic SSR `*.zhiye.com` HTML tables.
 * @param {string} html
 * @param {string} companyName
 * @param {string} origin
 * @returns {import('./_types.js').Job[]}
 */
export function parseZhiyeHtml(html, companyName, origin) {
  if (typeof html !== 'string' || !html) return [];
  const jobs = [];
  const seen = new Set();
  const linkRe = /<a[^>]+href=["']([^"']*(?:\/jobs\/detail\/|\/zpdetail\/|\/campus\/detail\/|\/social\/detail\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const href = match[1].trim();
    const title = htmlToText(match[2]).trim();
    if (!title || title.length < 2 || /^(查看|详情|立即投递|申请)$/.test(title)) continue;
    let fullUrl = href;
    if (href.startsWith('/')) fullUrl = `${origin}${href}`;
    else if (!/^https?:\/\//i.test(href)) fullUrl = `${origin}/${href}`;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    jobs.push({
      title: title.slice(0, 200),
      url: fullUrl,
      company: companyName,
      location: '',
      description: '',
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'zhiye',

  detect(entry) {
    const origin = resolveZhiyeOrigin(entry?.careers_url);
    return origin ? { url: origin } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveZhiyeOrigin(entry?.careers_url);
    if (!origin) {
      throw new Error('zhiye: careers_url must use HTTPS on a *.zhiye.com tenant');
    }
    const companyName = entry.name || origin;
    const keywords = Array.isArray(entry.keywords) && entry.keywords.length ? entry.keywords : DEFAULT_KEYWORDS;
    const maxPages = Math.min(Number(entry.max_pages) || DEFAULT_MAX_PAGES, Number(ctx?.maxPages) || DEFAULT_MAX_PAGES);
    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();

    // 1. Try Beisen JSON API first
    const api = `${origin}/api/JobAd/GetJobAdPageList`;
    for (const keyword of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
        try {
          const json = await ctx.fetchJson(api, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'accept': 'application/json',
              'user-agent': MACOS_BROWSER_LIKE_USER_AGENT,
              'referer': `${origin}/`,
            },
            body: JSON.stringify({ PageIndex: page, PageSize: PAGE_SIZE, KeyWords: keyword || '' }),
          });
          const { jobs, total } = parseZhiyeResponse(json, companyName, origin);
          if (!jobs.length) break;
          for (const job of jobs) {
            if (!seen.has(job.url)) seen.set(job.url, job);
          }
          if (page * PAGE_SIZE >= total) break;
        } catch {
          break;
        }
      }
    }
    if (seen.size > 0) return [...seen.values()];

    // 2. Fallback to SSR HTML job links
    try {
      const html = await ctx.fetchText(entry.careers_url, {
        headers: {
          'user-agent': MACOS_BROWSER_LIKE_USER_AGENT,
          'accept': 'text/html,application/xhtml+xml',
        },
      });
      for (const job of parseZhiyeHtml(html, companyName, origin)) {
        if (!seen.has(job.url)) seen.set(job.url, job);
      }
    } catch {
      // Ignore unreachable/WAF tenant in batch mode
    }
    return [...seen.values()];
  },
};
