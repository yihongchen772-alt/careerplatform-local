import { spawn } from "node:child_process";
import path from "node:path";
import { db } from "@/lib/db";

/**
 * 小欧's 「找岗位」: live job lists straight from company career sites, through
 * the job-board fetchers of career-ops (github.com/santifer/career-ops, MIT),
 * vendored in electron/career-ops. They run in a separate Node process —
 * see electron/career-ops/run.mjs for why.
 */

export type BoardJob = { title: string; url: string; location: string; company: string; postedAt: number | null; description: string };
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
    // Inside the App this process is Electron running as Node; the flag
    // keeps the child that way too.
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

const normal = (text: string) => text.toLowerCase().replace(/[\s（）()【】\[\]·\-—_/|,，、]/g, "");

/**
 * Searches the boards for `query` (space-separated keywords; a company name
 * in it narrows to that company). Jobs already in the 候选池 or 投递记录 are
 * left out; with `cities`, jobs elsewhere go to the end.
 */
export async function findJobs(userId: string, query: string, cities: string[] = []) {
  const terms = query.split(/[\s,，、]+/).map((term) => term.trim()).filter(Boolean).slice(0, 4);
  const companies = await db.company.findMany({ where: { careerUrl: { not: null } }, select: { name: true, careerUrl: true, aliases: { select: { alias: true } } } });
  const directory = companies.filter((company) => supportedBoard(company.careerUrl)).map((company) => ({ name: company.name, careers_url: company.careerUrl!, aliases: company.aliases.map((entry) => entry.alias) }));
  const all = [...directory, ...BUILT_IN_BOARDS.filter((board) => !directory.some((entry) => new URL(entry.careers_url.startsWith("http") ? entry.careers_url : `https://${entry.careers_url}`).hostname === new URL(board.careers_url).hostname)).map((board) => ({ ...board, aliases: [] as string[] }))];
  // 「字节 产品经理」: the company term picks the board, the rest is the search.
  const named = all.filter((board) => terms.some((term) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name)))));
  const keywords = named.length ? terms.filter((term) => !named.some((board) => [board.name, ...board.aliases].some((name) => normal(name).includes(normal(term)) || normal(term).includes(normal(name))))) : terms;
  const boards = (named.length ? named : all).slice(0, 12).map((board) => ({ name: board.name, careers_url: board.careers_url, keywords: keywords.length ? [keywords.join(" ")] : [] }));
  const results = await runBoards(boards);

  const [positions, applications] = await Promise.all([
    db.position.findMany({ where: { userId }, select: { jdUrl: true, title: true, company: { select: { name: true } } } }),
    db.application.findMany({ where: { userId }, select: { applyUrl: true, title: true, company: { select: { name: true } } } }),
  ]);
  const knownUrls = new Set([...positions.map((p) => p.jdUrl), ...applications.map((a) => a.applyUrl)].filter(Boolean).map((url) => url!.replace(/^http:/, "https:")));
  const knownTitles = new Set([...positions, ...applications].map((row) => `${normal(row.company.name)}|${normal(row.title)}`));
  const cityTerms = cities.map((city) => city.replace(/市$/, "")).filter(Boolean);
  const jobs = results.flatMap((result) => result.jobs.map((job) => ({ ...job, company: job.company || result.name, board: result.name })))
    .filter((job) => !knownUrls.has(job.url.replace(/^http:/, "https:")) && !knownTitles.has(`${normal(job.company)}|${normal(job.title)}`))
    .filter((job) => !keywords.length || keywords.some((term) => normal(job.title + job.description).includes(normal(term))));
  const inCity = (job: BoardJob) => !cityTerms.length || cityTerms.some((city) => job.location.includes(city));
  jobs.sort((a, b) => Number(inCity(b)) - Number(inCity(a)) || (b.postedAt ?? 0) - (a.postedAt ?? 0));
  return {
    jobs: jobs.slice(0, 30),
    total: jobs.length,
    searched: results.map((result) => ({ name: result.name, found: result.jobs.length, error: result.error === "unsupported" ? "这个网站暂不支持" : result.error ?? null })),
  };
}
