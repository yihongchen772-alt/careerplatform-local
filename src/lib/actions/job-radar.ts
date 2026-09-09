"use server";

import crypto from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { LOCAL_USER_ID, requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { renderPageText } from "@/lib/render-bridge-client";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = "Mozilla/5.0 (compatible; CareerCompassRadar/1.0)";

// A JS-rendered SPA's server-sent HTML is usually just an empty app shell —
// plain fetch() never runs its scripts, so the extracted text stays tiny no
// matter how many jobs are actually posted there. Below this length the
// static-HTML tier is treated as unreliable and the render-bridge tier is
// tried instead.
const SPA_TEXT_LENGTH_THRESHOLD = 200;

// Bounds the AI extraction prompt's cost — a career page's full text rarely
// needs more than this to list every open role; anything past it is almost
// always repeated nav/footer boilerplate on a paginated listing.
const MAX_EXTRACTION_CHARS = 15000;

function extractVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function timedFetchText(url: string, headers: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

type SourceTier = "STRUCTURED_API" | "STATIC_HTML" | "BROWSER_RENDERED";

type FetchOutcome = { text: string; tier: SourceTier; warning: string | null };

/**
 * Three-tier fetch, tried in priority order: a manually-registered JSON/API
 * override (structuredApiUrl) beats static HTML, which beats a headless
 * render — each tier costs more (in reliability risk or latency) than the
 * one before it, so this only drops down when the cheaper tier actually
 * fails or comes back too thin to be real job content.
 */
async function resolveContent(company: {
  careerUrl: string | null;
  structuredApiUrl: string | null;
}): Promise<FetchOutcome> {
  if (company.structuredApiUrl) {
    try {
      const body = await timedFetchText(company.structuredApiUrl, {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
      });
      if (body.trim().length > 0) return { text: body, tier: "STRUCTURED_API", warning: null };
    } catch {
      // Registered endpoint is down/changed shape — fall through to the
      // career page itself rather than erroring outright.
    }
  }

  if (!company.careerUrl) {
    if (company.structuredApiUrl) throw new Error("登记的接口地址抓取失败，且没有填写招聘官网链接作为备选");
    throw new Error("没有填写招聘官网链接");
  }

  let staticText = "";
  let staticFetchFailed = false;
  try {
    const html = await timedFetchText(company.careerUrl, { "User-Agent": USER_AGENT });
    staticText = extractVisibleText(html);
  } catch {
    staticFetchFailed = true;
  }

  if (staticText.length >= SPA_TEXT_LENGTH_THRESHOLD) {
    return { text: staticText, tier: "STATIC_HTML", warning: null };
  }

  // Static HTML came back empty/too-thin (or failed outright) — likely a
  // JS-rendered SPA. Ask the desktop app's hidden BrowserWindow to render it.
  try {
    const rendered = await renderPageText(company.careerUrl);
    if (rendered.trim().length > 0) return { text: rendered, tier: "BROWSER_RENDERED", warning: null };
  } catch {
    // Render bridge unavailable (e.g. not running inside the desktop app) or
    // the page itself failed to render — fall back to whatever static text
    // exists below.
  }

  if (staticText.length > 0) {
    return {
      text: staticText,
      tier: "STATIC_HTML",
      warning: "抓到的页面内容很少，且渲染抓取也没能补上——检测不到变化不代表没有新岗位，建议偶尔手动去看看",
    };
  }

  throw new Error(staticFetchFailed ? "抓取失败，检查一下链接是否能正常访问" : "抓到的页面内容是空的");
}

const extractionResultSchema = z.object({
  jobs: z.array(z.object({ title: z.string(), summary: z.string() })),
});

/**
 * Turns raw fetched content (HTML text, or a JSON API body handed through
 * as-is) into a structured job-postings list. This is the one AI call per
 * check — gated behind the hash-diff pre-filter in checkOne so it only ever
 * fires when the page's content actually changed.
 */
async function extractJobs(content: string): Promise<{ title: string; summary: string }[]> {
  const config = await getUserAiConfig(LOCAL_USER_ID);
  const raw = await callTextAi({
    config,
    timeoutMs: 45000,
    thinkingBudget: 512,
    prompt: `下面是从一家公司招聘页面抓取到的内容，可能是网页正文，也可能是一个 JSON 接口的原始返回。请从中提取所有具体的招聘岗位（忽略导航栏、页脚、公司介绍等非岗位内容）。

对每个岗位给出：
- title：岗位名称，去掉编号/多余的地点后缀，同一个岗位不要重复列出
- summary：一两句话概括这个岗位的关键信息（比如方向、地点、学历要求），从原文里能看出多少写多少；如果原文没有额外信息，summary 写岗位名称本身即可，不要编造原文没有的内容

如果整段内容里根本没有具体的岗位列表（比如只是通用介绍文案、404 页面、登录页），jobs 返回空数组。

抓取到的内容：
${content.slice(0, MAX_EXTRACTION_CHARS)}`,
    schema: {
      type: "OBJECT",
      properties: {
        jobs: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              summary: { type: "STRING" },
            },
            required: ["title", "summary"],
          },
        },
      },
      required: ["jobs"],
    },
  });

  const parsed = extractionResultSchema.safeParse(raw);
  if (!parsed.success) return [];

  const byTitle = new Map<string, { title: string; summary: string }>();
  for (const job of parsed.data.jobs) {
    const title = job.title.trim();
    if (!title) continue;
    byTitle.set(title, { title, summary: job.summary.trim() });
  }
  return [...byTitle.values()];
}

export type RadarJobEventResult = {
  title: string;
  type: "NEW" | "UPDATED" | "REMOVED";
  detail: string | null;
};

/**
 * Diffs a freshly-extracted job list against RadarJobPosting rows and
 * persists the result. On the very first check for a company there is
 * nothing to diff against yet — that check just establishes the baseline,
 * so isFirstCheck suppresses event creation (a company's first-ever radar
 * run should never look like every job on the page just "appeared").
 */
async function diffAndPersistJobs(
  companyId: string,
  extractedJobs: { title: string; summary: string }[],
  isFirstCheck: boolean
): Promise<RadarJobEventResult[]> {
  const existing = await db.radarJobPosting.findMany({ where: { companyId } });
  const existingByTitle = new Map(existing.map((p) => [p.title, p]));
  const extractedTitles = new Set(extractedJobs.map((j) => j.title));
  const events: RadarJobEventResult[] = [];
  const now = new Date();

  for (const job of extractedJobs) {
    const prior = existingByTitle.get(job.title);
    if (!prior || prior.removedAt) {
      await db.radarJobPosting.upsert({
        where: { companyId_title: { companyId, title: job.title } },
        create: { companyId, title: job.title, summary: job.summary, firstSeenAt: now, lastSeenAt: now },
        update: { summary: job.summary, lastSeenAt: now, removedAt: null },
      });
      if (!isFirstCheck) events.push({ title: job.title, type: "NEW", detail: job.summary });
    } else if (prior.summary !== job.summary) {
      await db.radarJobPosting.update({
        where: { id: prior.id },
        data: { summary: job.summary, lastSeenAt: now },
      });
      if (!isFirstCheck) events.push({ title: job.title, type: "UPDATED", detail: job.summary });
    } else {
      await db.radarJobPosting.update({ where: { id: prior.id }, data: { lastSeenAt: now } });
    }
  }

  if (!isFirstCheck) {
    for (const prior of existing) {
      if (!prior.removedAt && !extractedTitles.has(prior.title)) {
        await db.radarJobPosting.update({ where: { id: prior.id }, data: { removedAt: now } });
        events.push({ title: prior.title, type: "REMOVED", detail: null });
      }
    }
  }

  if (events.length > 0) {
    await db.radarJobEvent.createMany({
      data: events.map((e) => ({ companyId, title: e.title, type: e.type, detail: e.detail })),
    });
  }

  return events;
}

export type RadarCheckResult = {
  companyId: string;
  name: string;
  changed: boolean;
  events: RadarJobEventResult[];
  warning: string | null;
  error: string | null;
};

async function checkOne(company: {
  id: string;
  name: string;
  careerUrl: string | null;
  structuredApiUrl: string | null;
  radarContentHash: string | null;
}): Promise<RadarCheckResult> {
  let outcome: FetchOutcome;
  try {
    outcome = await resolveContent(company);
  } catch (err) {
    const message = err instanceof Error ? err.message : "抓取失败";
    await db.company.update({
      where: { id: company.id },
      data: { radarLastCheckedAt: new Date(), radarLastError: message },
    });
    return { companyId: company.id, name: company.name, changed: false, events: [], warning: null, error: message };
  }

  const hash = crypto.createHash("sha256").update(outcome.text).digest("hex");
  const isFirstCheck = company.radarContentHash === null;
  const hashChanged = !isFirstCheck && company.radarContentHash !== hash;

  // Free pre-filter: only pay for the AI extraction call when the page's
  // content actually changed (or this is the first-ever check, which needs
  // to establish a baseline job list).
  if (!hashChanged && !isFirstCheck) {
    await db.company.update({
      where: { id: company.id },
      data: { radarLastCheckedAt: new Date(), radarLastError: null, radarLastWarning: outcome.warning },
    });
    return { companyId: company.id, name: company.name, changed: false, events: [], warning: outcome.warning, error: null };
  }

  let events: RadarJobEventResult[] = [];
  try {
    const jobs = await extractJobs(outcome.text);
    events = await diffAndPersistJobs(company.id, jobs, isFirstCheck);
  } catch {
    // AI extraction failed (rate limit, timeout, no key configured) — still
    // record the new hash below so the next check has a fresh baseline,
    // just without job-level detail this round.
  }

  await db.company.update({
    where: { id: company.id },
    data: {
      radarContentHash: hash,
      radarLastCheckedAt: new Date(),
      ...(events.length > 0 ? { radarLastChangedAt: new Date() } : {}),
      radarLastError: null,
      radarLastWarning: outcome.warning,
    },
  });

  return {
    companyId: company.id,
    name: company.name,
    changed: events.length > 0,
    events,
    warning: outcome.warning,
    error: null,
  };
}

export async function setCompanyRadar(
  companyId: string,
  enabled: boolean
): Promise<ActionResult<{ enabled: boolean }>> {
  return toActionResult(async () => {
    await requireUser();
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { careerUrl: true, structuredApiUrl: true },
    });
    if (!company) throw new UserFacingError("公司不存在");
    if (enabled && !company.careerUrl && !company.structuredApiUrl) {
      throw new UserFacingError("先给这家公司填上招聘官网链接（或登记的接口地址），才能开启岗位雷达");
    }
    await db.company.update({ where: { id: companyId }, data: { radarEnabled: enabled } });
    revalidatePath("/companies");
    return { enabled };
  });
}

export async function setCompanyStructuredApiUrl(
  companyId: string,
  url: string | null
): Promise<ActionResult<{ structuredApiUrl: string | null }>> {
  return toActionResult(async () => {
    await requireUser();
    const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new UserFacingError("公司不存在");
    const trimmed = url?.trim() || null;
    await db.company.update({ where: { id: companyId }, data: { structuredApiUrl: trimmed } });
    revalidatePath("/companies");
    return { structuredApiUrl: trimmed };
  });
}

export async function checkSingleCompanyRadar(
  companyId: string
): Promise<ActionResult<RadarCheckResult>> {
  return toActionResult(async () => {
    await requireUser();
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, careerUrl: true, structuredApiUrl: true, radarContentHash: true },
    });
    if (!company) throw new UserFacingError("公司不存在");
    const result = await checkOne(company);
    revalidatePath("/companies");
    revalidatePath("/leads");
    return result;
  });
}

/**
 * Called from the /api/job-radar/check route, which Electron's main process
 * hits on its own timer — not a client-invoked server action, so no
 * requireUser() here (the route itself checks that) and no ActionResult
 * wrapper (there's no UI waiting on a UserFacingError message).
 */
export async function checkAllCompanyRadars(): Promise<{
  changed: { companyId: string; name: string; newCount: number }[];
  checkedCount: number;
  errorCount: number;
}> {
  const companies = await db.company.findMany({
    where: {
      radarEnabled: true,
      OR: [{ careerUrl: { not: null } }, { structuredApiUrl: { not: null } }],
    },
    select: { id: true, name: true, careerUrl: true, structuredApiUrl: true, radarContentHash: true },
  });

  const results = await Promise.allSettled(companies.map((c) => checkOne(c)));
  const changed: { companyId: string; name: string; newCount: number }[] = [];
  let errorCount = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.changed) {
        changed.push({
          companyId: r.value.companyId,
          name: r.value.name,
          newCount: r.value.events.filter((e) => e.type === "NEW").length,
        });
      }
      if (r.value.error) errorCount++;
    } else {
      errorCount++;
    }
  }

  revalidatePath("/companies");
  revalidatePath("/leads");
  return { changed, checkedCount: companies.length, errorCount };
}

/** Recent NEW/UPDATED/REMOVED events across all radar-enabled companies, newest first — powers the /leads page's event feed. */
export async function getRecentRadarEvents(limit = 50) {
  await requireUser();
  return db.radarJobEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { company: { select: { id: true, name: true } } },
  });
}

/**
 * Turns one radar-detected NEW posting into a real JobLead row — deliberately
 * a manual, per-click action rather than something the background check does
 * automatically. Radar events are AI-parsed from whatever the page happened
 * to render, not verified job postings, so silently writing them into the
 * user's information library on a timer would risk polluting it with
 * misreads with no one having actually looked.
 */
export async function importRadarJobToLeads(
  companyId: string,
  title: string
): Promise<ActionResult<{ created: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const [company, posting] = await Promise.all([
      db.company.findUnique({ where: { id: companyId }, select: { name: true, careerUrl: true } }),
      db.radarJobPosting.findUnique({ where: { companyId_title: { companyId, title } } }),
    ]);
    if (!company) throw new UserFacingError("公司不存在");
    if (!posting) throw new UserFacingError("这个岗位记录不存在了，可能已经被移除");

    const existing = await db.jobLead.findFirst({
      where: { userId: user.id, companyName: company.name, title },
      select: { id: true },
    });
    if (existing) return { created: false };

    await db.jobLead.create({
      data: {
        userId: user.id,
        companyName: company.name,
        title,
        note: posting.summary,
        source: "岗位雷达",
        jdUrl: company.careerUrl ?? undefined,
      },
    });
    revalidatePath("/leads");
    return { created: true };
  });
}
