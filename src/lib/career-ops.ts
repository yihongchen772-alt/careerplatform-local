import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { db } from "@/lib/db";
import { isDayeeUrl } from "@/lib/ats-platform";
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

export type CatalogBoard = {
  name: string;
  careers_url: string;
  industry?: string;
  tier?: "core" | "dayee" | "extended";
  track?: string;
};

function loadCatalogBoards(): CatalogBoard[] {
  try {
    const dir = process.env.CAREERPLATFORM_CAREER_OPS_DIR || path.join(process.cwd(), "electron", "career-ops");
    const raw = fs.readFileSync(path.join(dir, "boards-catalog.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as CatalogBoard[];
  } catch { /* fall back to inline seed */ }
  return [
    { name: "字节跳动校招", careers_url: "https://jobs.bytedance.com/campus/position", industry: "互联网/AI", tier: "core" },
    { name: "DeepSeek", careers_url: "https://app.mokahr.com/social-recruitment/high-flyer/140576", industry: "AI大模型/量化", tier: "core" },
    { name: "科大讯飞", careers_url: "https://iflytek.zhiye.com/campus", industry: "AI大模型/语音", tier: "core" },
  ];
}

const ALL_CATALOG_BOARDS = loadCatalogBoards();

/**
 * Core built-in boards focused exclusively on the three standardized domestic ATS
 * platforms that work seamlessly with one-click autofill:
 *   1. 飞书招聘 (jobs.bytedance.com / *.jobs.feishu.cn)
 *   2. Moka (app.mokahr.com)
 *   3. 北森 Beisen (*.zhiye.com)
 */
export const BUILT_IN_BOARDS: CatalogBoard[] = ALL_CATALOG_BOARDS.filter((b) => (b.tier ?? "core") === "core");

/** Extended boards (Step 2: Dayee 大易 + 腾讯/阿里/美团 + Global Frontier AI ATS). */
export const EXTENDED_BOARDS: CatalogBoard[] = ALL_CATALOG_BOARDS.filter((b) => (b.tier ?? "core") !== "core");

/** Hosts the vendored fetchers can read (what each provider's detect() claims). */
const SUPPORTED_HOST = /(^|\.)(jobs\.bytedance\.com|jobs\.feishu\.cn|careers\.tencent\.com|join\.qq\.com|talent\.alibaba\.com|careers\.aliyun\.com|talent\.taotian\.com|talent-holding\.alibaba\.com|zhaopin\.meituan\.com|mokahr\.com|zhiye\.com|hotjob\.cn|dayee\.com|myworkdayjobs\.com|successfactors\.(com|eu)|jobs2web\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|ashbyhq\.com)$/i;

export function supportedBoard(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return SUPPORTED_HOST.test(parsed.hostname) || isDayeeUrl(parsed.href);
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
    child.stdin.end(JSON.stringify({
      boards,
      maxBoards: Math.max(boards.length, 40),
      maxPages: 2,
      timeoutMs: Math.min(timeoutMs, 30000),
    }));
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
  const kindSuffix =
    jobKind === "social"
      ? "社招 招聘"
      : jobKind === "intern"
        ? "实习 招聘"
        : jobKind === "campus"
          ? "校招 校园招聘"
          : "招聘";
  const atsFilter = "(site:app.mokahr.com OR site:zhiye.com OR site:jobs.feishu.cn OR site:jobs.bytedance.com OR site:hotjob.cn)";
  const searchBing = async (searchTerms: string): Promise<BoardJob[]> => {
    const endpoint = `https://cn.bing.com/search?q=${encodeURIComponent(searchTerms)}&count=15`;
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
      const blocks = html.split(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>/i).slice(1, 16);
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
        const sourceLabel = /mokahr\.com/i.test(url)
          ? "Moka直招"
          : /zhiye\.com/i.test(url)
            ? "北森直招"
            : /feishu\.cn|bytedance\.com/i.test(url)
              ? "飞书直招"
              : isDayeeUrl(url)
                ? "大易直招"
                : "全网检索";
        out.push({
          company,
          title: title.slice(0, 120),
          url,
          location: hitCity,
          postedAt: null,
          description: description.slice(0, 260),
          sourceType: "web",
          sourceLabel,
        });
      }
      return out;
    } catch {
      return [];
    }
  };
  const cityHint = cities[0] ? ` ${cities[0]}` : "";
  const primary = await searchBing(`${query}${cityHint} ${kindSuffix} ${atsFilter}`.trim());
  if (primary.length >= 4 || !cityHint) return primary;
  const fallback = await searchBing(`${query} ${kindSuffix} ${atsFilter}`.trim());
  const seen = new Set(primary.map((item) => item.url));
  return [...primary, ...fallback.filter((item) => !seen.has(item.url))];
}

const TRACK_HINT_RULES: { pattern: RegExp; tracks: string[]; industries: RegExp }[] = [
  {
    pattern: /机器人|具身|灵巧手|人形|运动控制|运控|伺服|plc|自动驾驶|智驾|slam|ros|飞控|无人机|激光雷达|传感器|芯片|半导体|ic|fpga|嵌入式|mcu|rtos|硬件|电源|光学|汽车/i,
    tracks: ["core-robotics-hardtech", "ext-global"],
    industries: /机器人|具身|智驾|自动驾驶|汽车|芯片|半导体|硬件|装备|无人机|激光|光电|能源|锂电|工业/,
  },
  {
    pattern: /ai|大模型|llm|rag|agent|算法|机器学习|深度学习|nlp|cv|多模态|算力|后端|前端|全栈|开发|java|golang|python|c\+\+|rust|测试|产品|数据|云|安全|运维/i,
    tracks: ["core-ai-tech", "ext-majors", "ext-global"],
    industries: /ai|大模型|互联网|软件|云|安全|数据|算力|游戏|电商|出海/i,
  },
  {
    pattern: /央企|国企|电网|电力|通信|航空|航天|轨交|军工|证券|券商|基金|量化|银行|保险|金融|医疗|器械|医药|生物|信创|大易|dayee/i,
    tracks: ["core-enterprise-fintech", "ext-dayee"],
    industries: /央企|国企|金融|券商|量化|银行|保险|医疗|医药|航空|航天|轨交|电力|装备|信创/,
  },
];

export type SearchableBoard = CatalogBoard & { aliases: string[]; fromDirectory?: boolean };

/** Scores how relevant a board catalog entry is for `terms` / `query` / `signal`. */
export function scoreBoardRelevance(
  board: SearchableBoard,
  terms: string[],
  query: string,
  signal?: ProfileMatchSignal
): number {
  let score = board.fromDirectory ? 20 : (board.tier ?? "core") === "core" ? 10 : 0;
  const nameHay = normal([board.name, ...(board.aliases || [])].join(" "));
  const metaHay = `${board.name} ${board.industry ?? ""} ${board.track ?? ""} ${board.careers_url}`.toLowerCase();

  for (const term of terms) {
    const nt = normal(term);
    if (!nt) continue;
    if (nameHay.includes(nt)) score += 100;
    if (board.industry && board.industry.toLowerCase().includes(term.toLowerCase())) score += 40;
  }

  for (const rule of TRACK_HINT_RULES) {
    if (rule.pattern.test(query)) {
      if (board.track && rule.tracks.includes(board.track)) score += 28;
      if (board.industry && rule.industries.test(board.industry)) score += 22;
    }
  }

  if (/大易|dayee|hotjob/i.test(query) && (board.track === "ext-dayee" || isDayeeUrl(board.careers_url))) score += 60;
  if (/moka/i.test(query) && /mokahr\.com/i.test(metaHay)) score += 50;
  if (/北森|zhiye/i.test(query) && /zhiye\.com/i.test(metaHay)) score += 50;
  if (/飞书|feishu|bytedance/i.test(query) && /feishu\.cn|bytedance\.com/i.test(metaHay)) score += 50;
  if (/外企|出海|global|english|海外|anthropic|openai|figure|waymo|databricks|stripe/i.test(query) && board.track === "ext-global") {
    score += 45;
  }

  if (signal?.baseTrackTerms?.length && board.industry) {
    for (const track of signal.baseTrackTerms) {
      if (board.industry.toLowerCase().includes(track)) score += 12;
    }
  }
  return score;
}

/** Picks the top-scoring `limit` boards across all 359+ core and extended portals instead of blind slicing. */
export function selectBoardsForDiscovery(
  allBoards: SearchableBoard[],
  terms: string[],
  query: string,
  signal?: ProfileMatchSignal,
  limit = 40
): { selected: SearchableBoard[]; named: SearchableBoard[] } {
  const named = allBoards.filter((board) =>
    terms.some((term) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name))))
  );
  if (named.length > 0) {
    return { selected: named.slice(0, limit), named };
  }
  const ranked = allBoards
    .map((board, index) => ({
      board,
      index,
      score: scoreBoardRelevance(board, terms, query, signal),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    selected: ranked.slice(0, limit).map((entry) => entry.board),
    named: [],
  };
}

function matchesDiscoveryKind(text: string, jobKind: JobDiscoveryKind): boolean {
  if (jobKind === "intern") return /实习|intern/i.test(text);
  if (jobKind === "campus") {
    if (/社会招聘|类型:\s*社招|第三方派遣|Third-party Associate/i.test(text)) return false;
    if (/经验:\s*(?:[3-9]|\d{2,}|[三四五六七八九十])年以上/i.test(text)) return false;
    return true;
  }
  if (jobKind === "social") return !/实习生|日常实习|暑期实习/i.test(text);
  return true;
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
    const directory: SearchableBoard[] = companies
      .filter((company) => supportedBoard(company.careerUrl))
      .map((company) => ({
        name: company.name,
        careers_url: company.careerUrl!,
        aliases: company.aliases.map((entry) => entry.alias),
        fromDirectory: true,
      }));
    const boardKey = (raw: string) => {
      try {
        const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        return `${u.hostname}${u.pathname.replace(/\/$/, "")}`;
      } catch {
        return raw;
      }
    };
    const seenKeys = new Set(directory.map((d) => boardKey(d.careers_url)));
    const allSearchable: SearchableBoard[] = [...directory];
    for (const board of [...BUILT_IN_BOARDS, ...EXTENDED_BOARDS]) {
      const k = boardKey(board.careers_url);
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      allSearchable.push({ ...board, aliases: [] });
    }
    const { selected, named } = selectBoardsForDiscovery(allSearchable, terms, query, signal, 40);
    keywords = named.length
      ? terms.filter((term) => !named.some((board) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name)))))
      : terms;
    const boards = selected.map((board) => ({ name: board.name, careers_url: board.careers_url, keywords: keywords.slice(0, 3) }));
    try {
      boardResults = await runBoards(boards);
    } catch (err) {
      boardError = err instanceof Error ? err.message : "官网直招抓取超时";
    }
    boardJobs = boardResults
      .flatMap((result) =>
        result.jobs.map((job) => ({
          ...job,
          company: (job.company || result.name).replace(/校招$/, ""),
          sourceType: "board" as const,
          sourceLabel: `${result.name}官网`,
        }))
      )
      .filter((job) => !keywords.length || keywords.some((term) => normal(`${job.title} ${job.location} ${job.description}`).includes(normal(term))))
      .filter((job) => matchesDiscoveryKind(`${job.title} ${job.description} ${job.sourceLabel || ""}`, jobKind));
  }

  let sheetJobs: BoardJob[] = [];
  if (options.includeSheets !== false && terms.length > 0) {
    const wordClauses = terms.slice(0, 3).map((word) => ({
      OR: [
        { company: { contains: word } },
        { roles: { contains: word } },
        { cities: { contains: word } },
        { industry: { contains: word } },
        { note: { contains: word } },
      ],
    }));
    const sheetRows = await db.campusPosting.findMany({
      where: {
        userId,
        positionId: null,
        AND: wordClauses,
      },
      orderBy: [{ startDate: { sort: "desc", nulls: "last" } }],
      take: 45,
    });
    sheetJobs = sheetRows
      .filter((row) => !!(row.applyUrl || row.noticeUrl))
      .filter((row) => matchesDiscoveryKind(`${row.kind || ""} ${row.roles || ""} ${row.note || ""}`, jobKind))
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
          sourceLabel: "直招池/信息表",
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
