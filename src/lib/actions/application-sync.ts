"use server";

import crypto from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ApplicationStage } from "@prisma/client";
import { db } from "@/lib/db";
import { LOCAL_USER_ID, requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { renderPageText } from "@/lib/render-bridge-client";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/stage-labels";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

// 网申进度同步 — reads each company's candidate portal ("我的投递") through
// the 网申浏览器's logged-in session and moves the matching applications
// forward on the board. Same shape as job-radar: render → hash-gate → one
// AI extraction → diff → persist; the differences are that the page is
// behind a login (hence the borrowed session) and the output is a stage
// change on the user's own records rather than a new lead, so it only ever
// moves *forward* and never touches a stage the user has already closed.

const TERMINAL_STAGES: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED"];
// Stages the portal is allowed to put an application into. ACCEPTED/DECLINED
// are the user's own decisions, not something a company page can tell us.
const SYNCABLE_STAGES: ApplicationStage[] = STAGE_ORDER.filter(
  (s) => s !== "ACCEPTED" && s !== "DECLINED"
);

const PAGE_TEXT_CAP = 12000;
const PORTAL_SYNC_NOTE_PREFIX = "网申进度同步";

const extractionSchema = z.object({
  needsLogin: z.boolean(),
  entries: z.array(
    z.object({
      applicationId: z.string(),
      portalStatus: z.string(),
      stage: z.string().nullish(),
      confident: z.boolean(),
    })
  ),
});

export type PortalSyncChange = {
  companyName: string;
  applicationId: string;
  title: string;
  from: ApplicationStage;
  to: ApplicationStage;
  portalStatus: string;
};

export type PortalSyncMatch = {
  companyName: string;
  applicationId: string;
  title: string;
  portalStatus: string;
};

export type PortalSyncUnmatched = {
  companyName: string;
  applicationId: string;
  title: string;
};

export type PortalSyncResult = {
  checked: number;
  skipped: number;
  changed: PortalSyncChange[];
  matched: PortalSyncMatch[];
  unmatched: PortalSyncUnmatched[];
  unchanged: string[];
  errors: { companyName: string; message: string }[];
};

function stageIndex(stage: ApplicationStage) {
  return STAGE_ORDER.indexOf(stage);
}

/** Forward-only, never out of a terminal stage, never into a user-decision stage. */
function shouldApply(current: ApplicationStage, next: ApplicationStage) {
  if (current === next) return false;
  if (TERMINAL_STAGES.includes(current)) return false;
  if (!SYNCABLE_STAGES.includes(next)) return false;
  if (next === "REJECTED") return true;
  return stageIndex(next) > stageIndex(current);
}

export async function setCompanyPortalUrl(
  companyId: string,
  url: string | null
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await requireUser();
    const trimmed = url?.trim() || null;
    if (trimmed && !/^https?:\/\//i.test(trimmed)) throw new UserFacingError("进度页地址要以 http(s):// 开头");
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) throw new UserFacingError("未找到该公司");
    await db.company.update({
      where: { id: companyId },
      data: {
        portalUrl: trimmed,
        // A new URL is a new page — the old hash would suppress the first read.
        portalContentHash: null,
        portalLastError: null,
        ...(trimmed ? {} : { portalLastCheckedAt: null }),
      },
    });
    revalidatePath("/applications");
    revalidatePath("/browser");
    revalidatePath("/companies");
    return null;
  });
}

async function extractStatuses(
  pageText: string,
  companyName: string,
  applications: { id: string; title: string; currentStage: ApplicationStage }[]
) {
  const config = await getUserAiConfig(LOCAL_USER_ID);
  const stageList = SYNCABLE_STAGES.map((s) => `${s}（${STAGE_LABELS[s]}）`).join("、");
  const prompt = `下面是求职者登录 ${companyName} 的招聘系统后，「我的投递 / 候选人中心」页面上的可见文字。请判断页面上每条投递记录当前的进度，并对应到求职者自己记录的投递。

求职者在这家公司记录的投递（用 applicationId 引用）：
${applications.map((a) => `- applicationId=${a.id}：${a.title}（本地记录的阶段：${STAGE_LABELS[a.currentStage]}）`).join("\n")}

页面文字：
${pageText}

要求：
1. needsLogin：如果页面明显是登录页/要求重新登录/会话过期（比如只有"登录""验证码""扫码"而没有任何投递记录），填 true，entries 留空。
2. entries：只列出页面上确实出现、且能对应到上面某条本地投递的记录。岗位名可能不完全一样（页面可能带部门、地点、编号），按语义对应；对应不上的不要硬凑。
3. portalStatus：页面上原样的进度文字，比如"简历筛选中""笔试已安排""面试中（一面）""已发 offer""流程终止"。
4. stage：把 portalStatus 映射到这些阶段之一：${stageList}。映射规则：投递成功/已投递/待处理 → APPLIED；简历筛选/评估/初筛 → SCREENING；测评/性格测试 → ASSESSMENT；笔试/在线测试/机试 → OA；一面/初面/业务面 → INTERVIEW_1；二面/复试 → INTERVIEW_2；三面/终面（非 HR）→ INTERVIEW_3；HR 面/HRBP 面 → HR_INTERVIEW；已发 offer/录用/待签约 → OFFER；不合适/流程终止/未通过/已淘汰/感谢信 → REJECTED。看不出是哪个阶段就填 null，不要猜。
5. confident：对"这条对应哪个 applicationId"和"stage 映射"都有把握才 true。

全部用 JSON 返回。`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 512,
    timeoutMs: 60000,
    schema: {
      type: "OBJECT",
      properties: {
        needsLogin: { type: "BOOLEAN" },
        entries: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              applicationId: { type: "STRING" },
              portalStatus: { type: "STRING" },
              stage: { type: "STRING", nullable: true },
              confident: { type: "BOOLEAN" },
            },
            required: ["applicationId", "portalStatus", "stage", "confident"],
          },
        },
      },
      required: ["needsLogin", "entries"],
    },
  });
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) throw new Error("AI 返回格式异常");
  return parsed.data;
}

async function syncOne(company: {
  id: string;
  name: string;
  portalUrl: string | null;
  portalContentHash: string | null;
}, force = false): Promise<{
  status: "changed" | "unchanged" | "skipped";
  changes: PortalSyncChange[];
  matched: PortalSyncMatch[];
  unmatched: PortalSyncUnmatched[];
}> {
  if (!company.portalUrl) return { status: "skipped", changes: [], matched: [], unmatched: [] };

  const applications = await db.application.findMany({
    where: { companyId: company.id, userId: LOCAL_USER_ID, currentStage: { notIn: TERMINAL_STAGES } },
    select: { id: true, title: true, currentStage: true },
  });
  // Nothing in flight at this company — no point loading the page.
  if (applications.length === 0) return { status: "skipped", changes: [], matched: [], unmatched: [] };

  const text = (await renderPageText(company.portalUrl, { useApplicationSession: true })).trim();
  if (!text) throw new Error("进度页渲染出来是空的");
  const pageHash = crypto.createHash("sha256").update(text).digest("hex");
  // A page can stay unchanged while the user's local list gains or loses an
  // application. Include stable ids and titles in the gate so that local
  // list changes trigger recognition without re-running on every stage move.
  const applicationSignature = applications
    .map((a) => `${a.id}\u0000${a.title}`)
    .sort()
    .join("\u0001");
  const hash = crypto
    .createHash("sha256")
    .update(`${pageHash}\u0000${applicationSignature}`)
    .digest("hex");
  if (!force && hash === company.portalContentHash) {
    await db.company.update({
      where: { id: company.id },
      data: { portalLastCheckedAt: new Date(), portalLastError: null },
    });
    return { status: "unchanged", changes: [], matched: [], unmatched: [] };
  }

  const extraction = await extractStatuses(text.slice(0, PAGE_TEXT_CAP), company.name, applications);
  if (extraction.needsLogin) {
    // Don't store the hash: once the user logs back in the page will differ
    // anyway, and we want the next check to actually read it.
    throw new Error("登录已过期——去网申浏览器重新登录这家公司的招聘系统");
  }

  const now = new Date();
  const changes: PortalSyncChange[] = [];
  const matched: PortalSyncMatch[] = [];
  const matchedIds = new Set<string>();
  for (const entry of extraction.entries) {
    const app = applications.find((a) => a.id === entry.applicationId);
    if (!app || !entry.confident) continue;
    // A malformed model response should not make one local application count
    // as several matches or write its portal status repeatedly.
    if (matchedIds.has(app.id)) continue;
    const portalStatus = entry.portalStatus.trim().slice(0, 100);
    matchedIds.add(app.id);
    matched.push({
      companyName: company.name,
      applicationId: app.id,
      title: app.title,
      portalStatus,
    });
    const next = SYNCABLE_STAGES.find((s) => s === entry.stage) ?? null;

    await db.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: app.id },
        data: { portalStatus, portalStatusAt: now },
      });
      if (!next || !shouldApply(app.currentStage, next)) return;
      await tx.stageHistory.create({
        data: {
          applicationId: app.id,
          stage: next,
          enteredAt: now,
          note: `${PORTAL_SYNC_NOTE_PREFIX}：官网显示「${portalStatus}」`,
        },
      });
      await tx.application.update({
        where: { id: app.id },
        data: { currentStage: next, currentStageDate: now },
      });
      changes.push({
        companyName: company.name,
        applicationId: app.id,
        title: app.title,
        from: app.currentStage,
        to: next,
        portalStatus,
      });
    });
  }

  await db.company.update({
    where: { id: company.id },
    data: { portalContentHash: hash, portalLastCheckedAt: now, portalLastError: null },
  });
  return {
    status: "changed",
    changes,
    matched,
    unmatched: applications
      .filter((a) => !matchedIds.has(a.id))
      .map((a) => ({ companyName: company.name, applicationId: a.id, title: a.title })),
  };
}

async function runSync(companyIds?: string[], force = false): Promise<PortalSyncResult> {
  const companies = await db.company.findMany({
    where: { portalUrl: { not: null }, ...(companyIds ? { id: { in: companyIds } } : {}) },
    select: { id: true, name: true, portalUrl: true, portalContentHash: true },
  });

  const result: PortalSyncResult = {
    checked: 0,
    skipped: 0,
    changed: [],
    matched: [],
    unmatched: [],
    unchanged: [],
    errors: [],
  };
  // Sequential on purpose: each check may open a hidden window and make an
  // AI call, and the render bridge already caps concurrency at 2.
  for (const company of companies) {
    try {
      const outcome = await syncOne(company, force);
      if (outcome.status === "skipped") result.skipped++;
      else {
        result.checked++;
        if (outcome.status === "unchanged") result.unchanged.push(company.name);
      }
      result.changed.push(...outcome.changes);
      result.matched.push(...outcome.matched);
      result.unmatched.push(...outcome.unmatched);
    } catch (err) {
      const message = err instanceof Error ? err.message : "同步失败";
      result.errors.push({ companyName: company.name, message });
      await db.company.update({
        where: { id: company.id },
        data: { portalLastCheckedAt: new Date(), portalLastError: message },
      });
    }
  }

  if (result.changed.length > 0 || result.errors.length > 0) {
    revalidatePath("/applications");
    revalidatePath("/dashboard");
    for (const c of result.changed) revalidatePath(`/applications/${c.applicationId}`);
  }
  revalidatePath("/browser");
  return result;
}

/** Called by the desktop app's background timer (src/app/api/application-sync/check). */
export async function syncAllPortals(): Promise<PortalSyncResult> {
  return runSync();
}

export async function syncPortalsNow(
  companyId?: string,
  force = false
): Promise<ActionResult<PortalSyncResult>> {
  return toActionResult(async () => {
    await requireUser();
    return runSync(companyId ? [companyId] : undefined, force);
  });
}
