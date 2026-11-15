// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Dayee / HotJob (用友大易 *.hotjob.cn / *.dayee.com) provider.
// Resolves tenant suite code (`SU<hex>`) either directly from the URL path or
// via `POST /wecruit/common/getSLD`, then queries the public
// `POST /wecruit/positionInfo/listPosition/SU<corpCode>` endpoint.

import { MACOS_BROWSER_LIKE_USER_AGENT, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 10;
const INTER_PAGE_DELAY_MS = 280;

const PRIVATE_OR_LOCAL_HOST_RE =
  /^(?:localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/i;

/**
 * Validate and extract origin + optional suite code from a Dayee / HotJob URL.
 * Supports both `*.hotjob.cn` / `*.dayee.com` and custom company domains carrying `/SU<hex>/pb/` or `/wecruit/`.
 * @param {unknown} value
 * @returns {{ origin: string, host: string, pathname: string, suiteCode: string | null } | null}
 */
export function parseDayeeUrl(value) {
  if (typeof value !== 'string') return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!host || PRIVATE_OR_LOCAL_HOST_RE.test(host)) return null;
  const isDayeeHost = host.endsWith('.hotjob.cn') || host.endsWith('.dayee.com');
  const suiteMatch = /\/SU([a-f0-9]{16,40})\b/i.exec(u.pathname);
  const isCustomDayeePath = !!(suiteMatch && /\/(?:pb|wecruit)\//i.test(u.pathname));
  if (!isDayeeHost && !isCustomDayeePath) return null;
  if ((host === 'www.hotjob.cn' || host === 'www.dayee.com') && !suiteMatch) {
    return null;
  }
  return {
    origin: u.origin,
    host,
    pathname: u.pathname,
    suiteCode: suiteMatch ? suiteMatch[1] : null,
  };
}

/**
 * Parse `/wecruit/positionInfo/listPosition/SU<corpCode>` JSON payload.
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin
 * @param {string} suiteCode
 * @param {number} recruitType
 * @returns {{ jobs: import('./_types.js').Job[], totalPage: number }}
 */
export function parseDayeeResponse(json, companyName, origin, suiteCode, recruitType) {
  const pageForm = json?.data?.pageForm;
  const list = pageForm?.pageData;
  if (!Array.isArray(list)) return { jobs: [], totalPage: 0 };

  const totalPage = Number(pageForm?.totalPage) || 0;
  const postTypeParam = recruitType === 1 ? 'campus' : recruitType === 12 ? 'interns' : 'social';
  const kindLabel = recruitType === 1 ? '校园招聘' : recruitType === 12 ? '实习招聘' : '社会招聘';

  const jobs = [];
  for (const item of list) {
    const title = String(item?.postName || '').trim();
    const rawId = item?.postId;
    if (!title || rawId == null) continue;
    const encodedId = safeEncodeURIComponent(String(rawId));
    if (!encodedId) continue;

    const url = `${origin}/SU${suiteCode}/pb/posDetail.html?postId=${encodedId}&postType=${postTypeParam}`;
    const rawLoc = String(item?.workPlaceStr || '').trim();
    const location = /全部地区|不限/.test(rawLoc) ? '' : rawLoc;

    const desc = [
      `类型: ${kindLabel}`,
      item?.projectName && `项目: ${item.projectName}`,
      item?.educationStr && `学历要求: ${item.educationStr}`,
      item?.postTypeName && `类别: ${item.postTypeName}`,
      item?.subject && `专业要求: ${item.subject}`,
      item?.endDate && !String(item.endDate).startsWith('3000-') && `截止: ${String(item.endDate).slice(0, 10)}`,
      item?.postDuty && htmlToText(item.postDuty),
      item?.postRequest && htmlToText(item.postRequest),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 3000);

    let postedAt;
    for (const candidate of [item?.publishDate, item?.publishFirstDate]) {
      if (!candidate) continue;
      const ms = Date.parse(String(candidate).replace(' ', 'T') + '+08:00');
      if (Number.isFinite(ms) && ms >= 946684800000) {
        postedAt = ms;
        break;
      }
    }

    jobs.push({
      title,
      url,
      company: companyName || String(item?.company || '').trim() || origin,
      location,
      description: desc,
      postedAt,
    });
  }

  return { jobs, totalPage };
}

/**
 * Resolve tenant `suiteCode` (`SU<hex>`) via `getSLD` when omitted from URL.
 * @param {{ origin: string, host: string, suiteCode: string | null }} parsed
 * @param {any} ctx
 * @returns {Promise<{ origin: string, suiteCode: string }>}
 */
async function resolveTenantSuite(parsed, ctx) {
  if (parsed.suiteCode) {
    return { origin: parsed.origin, suiteCode: parsed.suiteCode };
  }
  const sldRes = await ctx.fetchJson(`${parsed.origin}/wecruit/common/getSLD`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': MACOS_BROWSER_LIKE_USER_AGENT,
      referer: `${parsed.origin}/`,
    },
    body: new URLSearchParams({ sld: parsed.host }).toString(),
    redirect: 'error',
  });
  const link = String(sldRes?.data?.linkData?.link || sldRes?.data?.linkData?.wtLink || '');
  const m = /\/SU([a-f0-9]{16,40})\b/i.exec(link);
  if (!m) {
    throw new Error(`dayee: could not resolve tenant suite code from ${parsed.origin}`);
  }
  let targetOrigin = parsed.origin;
  try {
    const targetUrl = new URL(link);
    const th = targetUrl.hostname.toLowerCase();
    if (
      targetUrl.protocol === 'https:' &&
      !PRIVATE_OR_LOCAL_HOST_RE.test(th) &&
      (th.endsWith('.hotjob.cn') || th.endsWith('.dayee.com') || th === parsed.host)
    ) {
      targetOrigin = targetUrl.origin;
    }
  } catch { /* keep parsed.origin */ }
  return { origin: targetOrigin, suiteCode: m[1] };
}

/** @type {Provider} */
export default {
  id: 'dayee',

  detect(entry) {
    const parsed = parseDayeeUrl(entry?.careers_url);
    return parsed ? { url: entry.careers_url } : null;
  },

  async fetch(entry, ctx) {
    const parsed = parseDayeeUrl(entry?.careers_url);
    if (!parsed) {
      throw new Error('dayee: careers_url must be a valid https://*.hotjob.cn or *.dayee.com tenant URL');
    }

    const { origin, suiteCode } = await resolveTenantSuite(parsed, ctx);
    const apiUrl = `${origin}/wecruit/positionInfo/listPosition/SU${suiteCode}`;

    const recruitTypes = /campus|school/i.test(parsed.pathname)
      ? [1]
      : /intern/i.test(parsed.pathname)
        ? [12]
        : /social/i.test(parsed.pathname)
          ? [2]
          : [1, 2, 12];

    const keywords = Array.isArray(entry.keywords) && entry.keywords.length ? entry.keywords : [''];
    const entryMaxPages = Number(entry.max_pages) > 0 ? Number(entry.max_pages) : DEFAULT_MAX_PAGES;
    const maxPages = Math.min(entryMaxPages, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    let firstReq = true;
    let succeededOnce = false;

    for (const recruitType of recruitTypes) {
      for (const keyword of keywords) {
        for (let page = 1; page <= maxPages; page++) {
          if (firstReq) firstReq = false;
          else await sleep(INTER_PAGE_DELAY_MS, ctx);

          const form = new URLSearchParams({
            recruitType: String(recruitType),
            currentPage: String(page),
            pageSize: String(PAGE_SIZE),
          });
          if (keyword) form.set('postName', keyword);

          let json;
          try {
            json = await ctx.fetchJson(apiUrl, {
              method: 'POST',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'user-agent': MACOS_BROWSER_LIKE_USER_AGENT,
                referer: `${origin}/SU${suiteCode}/pb/school.html`,
              },
              body: form.toString(),
              redirect: 'error',
            });
          } catch (err) {
            if (!succeededOnce) throw err;
            return [...seen.values()];
          }

          if (json?.state && String(json.state) !== '200') {
            if (!succeededOnce) throw new Error(`dayee: API returned state=${json.state} (${json.msg || ''})`);
            break;
          }
          succeededOnce = true;

          const parsedPage = parseDayeeResponse(json, entry.name || parsed.host, origin, suiteCode, recruitType);
          if (parsedPage.jobs.length === 0) break;
          for (const job of parsedPage.jobs) {
            if (!seen.has(job.url)) seen.set(job.url, job);
          }
          if (parsedPage.totalPage > 0 && page >= parsedPage.totalPage) break;
        }
      }
    }

    return [...seen.values()];
  },
};
