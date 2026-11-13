import { spawn } from "node:child_process";
import path from "node:path";
import { db } from "@/lib/db";
import { extractProfileSignal, scorePostingMatch, type PostingMatchResult, type ProfileMatchSignal } from "@/lib/posting-match";

/**
 * 小欧's 「找岗位」 & 全网实时搜岗: combines live company ATS boards (via vendored
 * career-ops fetchers), subscribed 校招信息表 rows, and public web recruitment
 * discovery, then ranks results against the user's target track, cities & skills.
 */

export type BoardJob = {
  title: string;
  url: string;
  location: string;
  company: string;
  postedAt: number | null;
  description: string;
  sourceType?: "board" | "sheet" | "web";
  sourceLabel?: string;
  match?: PostingMatchResult;
};

type BoardResult = { name: string; provider: string | null; jobs: BoardJob[]; error?: string };

/** Big boards that need no setup; the 企业名录's own 招聘官网 links are added to these. */
export const BUILT_IN_BOARDS: { name: string; careers_url: string }[] = [
  { name: "字节跳动", careers_url: "https://jobs.bytedance.com" },
  { name: "腾讯", careers_url: "https://careers.tencent.com/search.html" },
  { name: "阿里巴巴", careers_url: "https://talent.alibaba.com/off-campus/position-list" },
  { name: "美团", careers_url: "https://zhaopin.meituan.com/web/social" },
];

/** Hosts the vendored fetchers can read (what each provider's detect() claims). */
const SUPPORTED_HOST = /(^|\.)(jobs\.bytedance\.com|jobs\.feishu\.cn|careers\.tencent\.com|talent\.alibaba\.com|zhaopin\.meituan\.com|mokahr\.com|myworkdayjobs\.com|successfactors\.(com|eu)|jobs2web\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|ashbyhq\.com)$/i;

export function supportedBoard(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return SUPPORTED_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

function runnerPath(): string {
  return path.join(process.env.CAREERPLATFORM_CAREER_OPS_DIR || path.join(process.cwd(), "electron", "career-ops"), "run.mjs");
}

async function runBoards(boards: { name: string; careers_url: string; keywords: string[] }[], timeoutMs = 40000): Promise<BoardResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath()], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill(), timeoutMs + 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out) as { results?: BoardResult[]; error?: string };
        if (!parsed.results) return reject(new Error(parsed.error || "找岗位失败"));
        resolve(parsed.results);
      } catch {
        reject(new Error("找岗位超时或没有结果"));
      }
    });
    child.stdin.end(JSON.stringify({ boards, maxPages: 2, timeoutMs: Math.min(timeoutMs, 30000) }));
  });
}

function decodeHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCompanyFromTitle(title: string, url: string): string {
  const cleaned = title.replace(/[-_|—·]\s*(?:招聘|校招|校园招聘|官网|职位|拉勾|猎聘|脉脉|BOSS|牛客).*$/i, "").trim();
  const dashSplit = cleaned.split(/[-—|·]/)[0]?.trim();
  if (dashSplit && dashSplit.length >= 2 && dashSplit.length <= 24) return dashSplit;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "官网招聘";
  }
}

export async function discoverWebCampusJobs(query: string, cities: string[] = []): Promise<BoardJob[]> {
  const cityHint = cities[0] ? ` ${cities[0]}` : "";
  const searchTerms = `${query}${cityHint} 校园招聘 网申 投递`.trim();
  const endpoint = `https://cn.bing.com/search?q=${encodeURIComponent(searchTerms)}&count=12`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: BoardJob[] = [];
    const blocks = html.split(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>/i).slice(1, 14);
    for (const block of blocks) {
      const linkMatch = /<h2[^>]*>[\s\S]*?<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (!linkMatch) continue;
      const url = linkMatch[1].replace(/&amp;/g, "&");
      const title = decodeHtml(linkMatch[2]);
      if (!title || /baidu\.com\/s\?|bing\.com\/ck\/|zhihu\.com\/question/i.test(url)) continue;
      const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
      const description = snippetMatch ? decodeHtml(snippetMatch[1]) : "";
      const company = inferCompanyFromTitle(title, url);
      const hitCity = cities.find((c) => `${title} ${description}`.includes(c.replace(/市$/, ""))) || "";
      out.push({
        company,
        title: title.slice(0, 120),
        url,
        location: hitCity,
        postedAt: null,
        description: description.slice(0, 260),
        sourceType: "web",
        sourceLabel: "全网检索",
      });
    }
    return out;
  } catch {
    return [];
  }
}

const normal = (text: string) => text.toLowerCase().replace(/[\s（）()【】\[\]·\-—_/|,，、]/g, "");

export type FindJobsOptions = {
  includeSheets?: boolean;
  includeWeb?: boolean;
  includeBoards?: boolean;
  signal?: ProfileMatchSignal;
};

/**
 * Searches official ATS boards + subscribed 校招信息表 + public web recruitment
 * for `query`. Jobs already in 候选池 or 投递记录 are omitted; results are scored
 * and ranked against the user's profile preferences and preferred cities.
 */
export async function findJobs(
  userId: string,
  query: string,
  cities: string[] = [],
  options: FindJobsOptions = {}
) {
  const terms = query.split(/[\s,，、]+/).map((term) => term.trim()).filter(Boolean).slice(0, 5);
  const [companies, userProfile, defaultResume, positions, applications] = await Promise.all([
    db.company.findMany({ where: { careerUrl: { not: null } }, select: { name: true, careerUrl: true, aliases: { select: { alias: true } } } }),
    options.signal
      ? Promise.resolve(null)
      : db.user.findUnique({ where: { id: userId }, select: { targetTrack: true, preferredCities: true, skills: true, graduationYear: true } }),
    options.signal
      ? Promise.resolve(null)
      : db.resumeVersion.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], select: { extractedText: true } }),
    db.position.findMany({ where: { userId }, select: { jdUrl: true, title: true, company: { select: { name: true } } } }),
    db.application.findMany({ where: { userId }, select: { applyUrl: true, title: true, company: { select: { name: true } } } }),
  ]);

  const signal = options.signal ?? extractProfileSignal(userProfile, defaultResume?.extractedText);
  const cityTerms = cities.map((city) => city.replace(/市$/, "")).filter(Boolean);
  const knownUrls = new Set([...positions.map((p) => p.jdUrl), ...applications.map((a) => a.applyUrl)].filter(Boolean).map((url) => url!.replace(/^http:/, "https:")));
  const knownTitles = new Set([...positions, ...applications].map((row) => `${normal(row.company.name)}|${normal(row.title)}`));

  let boardResults: BoardResult[] = [];
  let boardJobs: BoardJob[] = [];
  let keywords = terms;

  if (options.includeBoards !== false) {
    const directory = companies.filter((company) => supportedBoard(company.careerUrl)).map((company) => ({ name: company.name, careers_url: company.careerUrl!, aliases: company.aliases.map((entry) => entry.alias) }));
    const all = [...directory, ...BUILT_IN_BOARDS.filter((board) => !directory.some((entry) => new URL(entry.careers_url.startsWith("http") ? entry.careers_url : `https://${entry.careers_url}`).hostname === new URL(board.careers_url).hostname)).map((board) => ({ ...board, aliases: [] as string[] }))];
    const named = all.filter((board) => terms.some((term) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name)))));
    keywords = named.length ? terms.filter((term) => !named.some((board) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name))))) : terms;
    const boards = (named.length ? named : all).slice(0, 12).map((board) => ({ name: board.name, careers_url: board.careers_url, keywords: keywords.length ? [keywords.join(" ")] : [] }));
    boardResults = await runBoards(boards).catch(() => []);
    boardJobs = boardResults
      .flatMap((result) =>
        result.jobs.map((job) => ({
          ...job,
          company: job.company || result.name,
          sourceType: "board" as const,
          sourceLabel: `${result.name}官网`,
        }))
      )
      .filter((job) => !keywords.length || keywords.some((term) => normal(job.title + job.description).includes(normal(term))));
  }

  let sheetJobs: BoardJob[] = [];
  if (options.includeSheets !== false && terms.length > 0) {
    const sheetRows = await db.campusPosting.findMany({
      where: {
        userId,
        positionId: null,
        AND: terms.slice(0, 3).map((word) => ({
          OR: [
            { company: { contains: word } },
            { roles: { contains: word } },
            { cities: { contains: word } },
            { industry: { contains: word } },
            { note: { contains: word } },
          ],
        })),
      },
      orderBy: [{ startDate: { sort: "desc", nulls: "last" } }],
      take: 30,
    });
    sheetJobs = sheetRows
      .filter((row) => !!(row.applyUrl || row.noticeUrl))
      .map((row) => {
        const title = (row.roles || "").split(/[\n、,，;；]+/).find((s) => s.trim())?.trim() || `${row.cohort || ""}${row.kind || "校招"}`;
        return {
          company: row.company,
          title: title.slice(0, 100),
          url: (row.applyUrl || row.noticeUrl)!,
          location: row.cities || "",
          postedAt: row.startDate?.getTime() ?? null,
          description: [row.roles, row.industry, row.note].filter(Boolean).join(" · ").slice(0, 260),
          sourceType: "sheet" as const,
          sourceLabel: "已订阅校招表",
        };
      });
  }

  let webJobs: BoardJob[] = [];
  if (options.includeWeb) {
    webJobs = await discoverWebCampusJobs(query, cityTerms);
  }

  const seenUrls = new Set<string>();
  const combined = [...boardJobs, ...sheetJobs, ...webJobs].filter((job) => {
    const normUrl = job.url.replace(/^http:/, "https:");
    if (knownUrls.has(normUrl) || knownTitles.has(`${normal(job.company)}|${normal(job.title)}`)) return false;
    if (seenUrls.has(normUrl)) return false;
    seenUrls.add(normUrl);
    return true;
  });

  const enriched = combined.map((job) => ({
    ...job,
    match: signal.hasSignal
      ? scorePostingMatch(
          { companyName: job.company, title: job.title, tracks: job.title, cities: job.location, description: job.description },
          signal
        )
      : undefined,
  }));

  const inCity = (job: BoardJob) => !cityTerms.length || cityTerms.some((city) => job.location.includes(city));
  enriched.sort(
    (a, b) =>
      (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
      Number(inCity(b)) - Number(inCity(a)) ||
      (b.postedAt ?? 0) - (a.postedAt ?? 0)
  );

  return {
    jobs: enriched.slice(0, 40),
    total: enriched.length,
    channels: {
      boards: boardJobs.length,
      sheets: sheetJobs.length,
      web: webJobs.length,
    },
    searched: boardResults.map((result) => ({
      name: result.name,
      found: result.jobs.length,
      error: result.error === "unsupported" ? "这个网站暂不支持" : result.error ?? null,
    })),
  };
}
