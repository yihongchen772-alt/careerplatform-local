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

/** Big boards & live verified AI/tech tenants that need no setup; 企业名录 adds more. */
export const BUILT_IN_BOARDS: { name: string; careers_url: string; industry?: string }[] = [
  { name: "字节跳动", careers_url: "https://jobs.bytedance.com", industry: "互联网/AI" },
  { name: "腾讯", careers_url: "https://careers.tencent.com/search.html", industry: "互联网/游戏/AI" },
  { name: "阿里巴巴", careers_url: "https://talent.alibaba.com/off-campus/position-list", industry: "互联网/电商/云" },
  { name: "美团", careers_url: "https://zhaopin.meituan.com/web/social", industry: "互联网/本地生活" },
  { name: "DeepSeek", careers_url: "https://app.mokahr.com/social-recruitment/high-flyer/140576", industry: "AI大模型/量化" },
  { name: "DeepSeek校招", careers_url: "https://app.mokahr.com/campus-recruitment/high-flyer/140575", industry: "AI大模型/量化" },
  { name: "月之暗面", careers_url: "https://app.mokahr.com/apply/moonshot/148506", industry: "AI大模型" },
  { name: "智谱AI", careers_url: "https://app.mokahr.com/social-recruitment/zphz/148983", industry: "AI大模型" },
  { name: "MiniMax", careers_url: "https://vrfi1sk8a0.jobs.feishu.cn", industry: "AI大模型" },
  { name: "博世中国", careers_url: "https://jobs.smartrecruiters.com/BoschGroup", industry: "汽车/智能制造/外企" },
  { name: "Databricks", careers_url: "https://boards.greenhouse.io/databricks", industry: "云计算/大数据/AI" },
  { name: "Cloudflare", careers_url: "https://boards.greenhouse.io/cloudflare", industry: "云计算/基础架构" },
  { name: "Stripe", careers_url: "https://boards.greenhouse.io/stripe", industry: "金融科技/外企" },
  { name: "Figma", careers_url: "https://boards.greenhouse.io/figma", industry: "设计/研发工具" },
  { name: "Airbnb", careers_url: "https://boards.greenhouse.io/airbnb", industry: "互联网/外企" },
  { name: "Linear", careers_url: "https://jobs.ashbyhq.com/linear", industry: "研发工具/外企" },
];

/** Hosts the vendored fetchers can read (what each provider's detect() claims). */
const SUPPORTED_HOST = /(^|\.)(jobs\.bytedance\.com|jobs\.feishu\.cn|careers\.tencent\.com|talent\.alibaba\.com|zhaopin\.meituan\.com|mokahr\.com|zhiye\.com|myworkdayjobs\.com|successfactors\.(com|eu)|jobs2web\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|ashbyhq\.com)$/i;

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

export async function runBoards(boards: { name: string; careers_url: string; keywords: string[] }[], timeoutMs = 40000): Promise<BoardResult[]> {
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

export type JobDiscoveryKind = "all" | "campus" | "intern" | "social";

function inferCompanyFromTitle(title: string, url: string): string {
  const bracketed = /^【([^】]{2,20})】/.exec(title.trim());
  if (bracketed?.[1] && !/招聘|校招|社招|实习|热招|急招/.test(bracketed[1])) return bracketed[1].trim();
  const cleaned = title
    .replace(/[-_|—·：:]\s*(?:官方)?(?:招聘|校招|校园招聘|社招|社会招聘|实习招聘|官网|职位|加入我们|拉勾|猎聘|脉脉|BOSS|牛客|前程无忧|智联招聘).*$/i, "")
    .trim();
  const dashSplit = cleaned.split(/[-—|·：:]/)[0]?.trim();
  if (dashSplit && dashSplit.length >= 2 && dashSplit.length <= 20) return dashSplit;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "官网招聘";
  }
}

export async function discoverWebCampusJobs(
  query: string,
  cities: string[] = [],
  jobKind: JobDiscoveryKind = "all"
): Promise<BoardJob[]> {
  const cityHint = cities[0] ? ` ${cities[0]}` : "";
  const kindSuffix =
    jobKind === "social"
      ? "社招 招聘 官网"
      : jobKind === "intern"
        ? "实习生 招聘 网申"
        : jobKind === "campus"
          ? "校园招聘 网申 投递"
          : "招聘 官网 网申";
  const searchTerms = `${query}${cityHint} ${kindSuffix}`.trim();
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
  resumeVersionId?: string | null;
  jobKind?: JobDiscoveryKind;
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
  const jobKind: JobDiscoveryKind = options.jobKind ?? "all";
  const [companies, userProfile, targetResume, positions, applications] = await Promise.all([
    db.company.findMany({ where: { careerUrl: { not: null } }, select: { name: true, careerUrl: true, aliases: { select: { alias: true } } } }),
    options.signal
      ? Promise.resolve(null)
      : db.user.findUnique({ where: { id: userId }, select: { targetTrack: true, preferredCities: true, skills: true, graduationYear: true } }),
    options.signal
      ? Promise.resolve(null)
      : options.resumeVersionId
        ? db.resumeVersion.findFirst({ where: { id: options.resumeVersionId, userId }, select: { extractedText: true, structured: true } })
        : db.resumeVersion.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], select: { extractedText: true, structured: true } }),
    db.position.findMany({ where: { userId }, select: { jdUrl: true, title: true, company: { select: { name: true } } } }),
    db.application.findMany({ where: { userId }, select: { applyUrl: true, title: true, company: { select: { name: true } } } }),
  ]);

  const signal = options.signal ?? extractProfileSignal(userProfile, targetResume?.extractedText, targetResume?.structured);
  const cityTerms = cities.map((city) => city.replace(/市$/, "")).filter(Boolean);
  const knownUrls = new Set([...positions.map((p) => p.jdUrl), ...applications.map((a) => a.applyUrl)].filter(Boolean).map((url) => url!.replace(/^http:/, "https:")));
  const knownTitles = new Set([...positions, ...applications].map((row) => `${normal(row.company.name)}|${normal(row.title)}`));

  let boardResults: BoardResult[] = [];
  let boardJobs: BoardJob[] = [];
  let boardError: string | null = null;
  let keywords = terms;

  if (options.includeBoards !== false) {
    const directory = companies.filter((company) => supportedBoard(company.careerUrl)).map((company) => ({ name: company.name, careers_url: company.careerUrl!, aliases: company.aliases.map((entry) => entry.alias) }));
    const all = [...directory, ...BUILT_IN_BOARDS.filter((board) => !directory.some((entry) => new URL(entry.careers_url.startsWith("http") ? entry.careers_url : `https://${entry.careers_url}`).hostname === new URL(board.careers_url).hostname)).map((board) => ({ ...board, aliases: [] as string[] }))];
    const named = all.filter((board) => terms.some((term) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name)))));
    keywords = named.length ? terms.filter((term) => !named.some((board) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name))))) : terms;
    const boards = (named.length ? named : all).slice(0, 18).map((board) => ({ name: board.name, careers_url: board.careers_url, keywords: keywords.length ? [keywords.join(" ")] : [] }));
    try {
      boardResults = await runBoards(boards);
    } catch (err) {
      boardError = err instanceof Error ? err.message : "官网直招抓取超时";
    }
    boardJobs = boardResults
      .flatMap((result) =>
        result.jobs.map((job) => ({
          ...job,
          company: job.company || result.name,
          sourceType: "board" as const,
          sourceLabel: `${result.name}官网`,
        }))
      )
      .filter((job) => !keywords.length || keywords.some((term) => normal(`${job.title} ${job.location} ${job.description}`).includes(normal(term))))
      .filter((job) => {
        if (jobKind === "intern") return /实习|intern/i.test(`${job.title} ${job.description}`);
        if (jobKind === "campus") return !/社会招聘|社招|only senior/i.test(job.title);
        return true;
      });
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
    webJobs = await discoverWebCampusJobs(query, cityTerms, jobKind);
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
    warnings: boardError ? [boardError] : [],
    searched: boardResults.map((result) => ({
      name: result.name,
      found: result.jobs.length,
      error: result.error === "unsupported" ? "这个网站暂不支持" : result.error ?? null,
    })),
  };
}
