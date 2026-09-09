"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const FETCH_TIMEOUT_MS = 15000;

// A JS-rendered SPA's server-sent HTML is usually just an empty app shell —
// plain fetch() never runs its scripts, so the extracted text stays tiny no
// matter how many jobs are actually posted there. Below this length the diff
// is still recorded but flagged as unreliable rather than silently reported
// as "no change" (which would be indistinguishable from "nothing to see").
const SPA_TEXT_LENGTH_THRESHOLD = 200;

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

export type RadarCheckResult = {
  companyId: string;
  name: string;
  changed: boolean;
  warning: string | null;
  error: string | null;
};

async function checkOne(company: {
  id: string;
  name: string;
  careerUrl: string | null;
  radarContentHash: string | null;
}): Promise<RadarCheckResult> {
  if (!company.careerUrl) {
    return {
      companyId: company.id,
      name: company.name,
      changed: false,
      warning: null,
      error: "没有填写招聘官网链接",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(company.careerUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CareerCompassRadar/1.0)" },
    });
    if (!res.ok) {
      const message = `抓取失败：HTTP ${res.status}`;
      await db.company.update({
        where: { id: company.id },
        data: { radarLastCheckedAt: new Date(), radarLastError: message },
      });
      return { companyId: company.id, name: company.name, changed: false, warning: null, error: message };
    }

    const html = await res.text();
    const text = extractVisibleText(html);
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const warning =
      text.length < SPA_TEXT_LENGTH_THRESHOLD
        ? "抓到的页面内容很少，这个招聘页大概率是 JS 渲染的 SPA——检测不到变化不代表没有新岗位，建议偶尔手动去看看"
        : null;
    // Only the FIRST check ever establishes a baseline — nothing to diff
    // against yet, so it can never itself be a "change".
    const changed = company.radarContentHash !== null && company.radarContentHash !== hash;

    await db.company.update({
      where: { id: company.id },
      data: {
        radarContentHash: hash,
        radarLastCheckedAt: new Date(),
        ...(changed ? { radarLastChangedAt: new Date() } : {}),
        radarLastError: null,
        radarLastWarning: warning,
      },
    });
    return { companyId: company.id, name: company.name, changed, warning, error: null };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "抓取超时（15 秒）"
        : "抓取失败，检查一下链接是否能正常访问";
    await db.company.update({
      where: { id: company.id },
      data: { radarLastCheckedAt: new Date(), radarLastError: message },
    });
    return { companyId: company.id, name: company.name, changed: false, warning: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function setCompanyRadar(
  companyId: string,
  enabled: boolean
): Promise<ActionResult<{ enabled: boolean }>> {
  return toActionResult(async () => {
    await requireUser();
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { careerUrl: true },
    });
    if (!company) throw new UserFacingError("公司不存在");
    if (enabled && !company.careerUrl) {
      throw new UserFacingError("先给这家公司填上招聘官网链接，才能开启招聘页监控");
    }
    await db.company.update({ where: { id: companyId }, data: { radarEnabled: enabled } });
    revalidatePath("/companies");
    return { enabled };
  });
}

export async function checkSingleCompanyRadar(
  companyId: string
): Promise<ActionResult<RadarCheckResult>> {
  return toActionResult(async () => {
    await requireUser();
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, careerUrl: true, radarContentHash: true },
    });
    if (!company) throw new UserFacingError("公司不存在");
    const result = await checkOne(company);
    revalidatePath("/companies");
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
  changed: { companyId: string; name: string }[];
  checkedCount: number;
  errorCount: number;
}> {
  const companies = await db.company.findMany({
    where: { radarEnabled: true, careerUrl: { not: null } },
    select: { id: true, name: true, careerUrl: true, radarContentHash: true },
  });

  const results = await Promise.allSettled(companies.map((c) => checkOne(c)));
  const changed: { companyId: string; name: string }[] = [];
  let errorCount = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.changed) changed.push({ companyId: r.value.companyId, name: r.value.name });
      if (r.value.error) errorCount++;
    } else {
      errorCount++;
    }
  }

  revalidatePath("/companies");
  return { changed, checkedCount: companies.length, errorCount };
}
