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
import { classifyPortalTransition, isExplicitRejectionStatus } from "@/lib/application-flow";
import { portalOwnsApplication } from "@/lib/application-portal-scope";
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

export type PortalSyncReview = PortalSyncChange;

export type PortalSyncUnmatched = {
  companyName: string;
  applicationId: string;
  title: string;
};

export type PortalSyncResult = {
  checked: number;
  skipped: number;
  changed: PortalSyncChange[];
  review: PortalSyncReview[];
  matched: PortalSyncMatch[];
  unmatched: PortalSyncUnmatched[];
  unassigned: PortalSyncUnmatched[];
  unchanged: string[];
  errors: { companyName: string; message: string }[];
};

export async function setCompanyPortalUrl(
  companyId: string,
  url: string,
  label?: string | null
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await requireUser();
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) throw new UserFacingError("进度页地址要以 http(s):// 开头");
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) throw new UserFacingError("未找到该公司");
    await db.$transaction(async (tx) => {
      const existingCount = await tx.applicationPortal.count({ where: { companyId } });
      const portal = await tx.applicationPortal.upsert({
        where: { companyId_url: { companyId, url: trimmed } },
        create: { companyId, url: trimmed, label: label?.trim() || null },
        update: { label: label?.trim() || null, contentHash: null, lastError: null },
      });
      if (existingCount === 0) {
        await tx.application.updateMany({ where: { companyId, portalId: null }, data: { portalId: portal.id } });
      }
    });
    revalidatePath("/applications");
    revalidatePath("/browser");
    revalidatePath("/companies");
    return null;
  });
}

export async function deleteApplicationPortal(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await requireUser();
    const portal = await db.applicationPortal.findUnique({ where: { id } });
    if (!portal) throw new UserFacingError("未找到这个进度页");
    await db.applicationPortal.delete({ where: { id } });
    revalidatePath("/applications");
    revalidatePath("/browser");
    return null;
  });
}

export async function setApplicationPortal(applicationId: string, portalId: string | null): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const application = await db.application.findFirst({
      where: { id: applicationId, userId: user.id },
      select: { id: true, companyId: true },
    });
    if (!application) throw new UserFacingError("未找到这条投递");
    if (portalId) {
      const portal = await db.applicationPortal.findFirst({ where: { id: portalId, companyId: application.companyId } });
      if (!portal) throw new UserFacingError("进度页不属于这家公司");
    }
    await db.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: applicationId },
        data: { portalId, portalStatus: null, portalStatusAt: null, portalSuggestedStage: null, portalSuggestedAt: null },
      });
      if (portalId) await tx.applicationPortal.update({ where: { id: portalId }, data: { contentHash: null } });
    });
    revalidatePath("/applications");
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/browser");
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
4. stage：把 portalStatus 映射到这些宽泛类别之一：${stageList}。企业流程不一定按固定顺序，有的会跳过笔试、有的先 HR 面、有的有群面或多轮业务面；只按官网当前文字判断，不根据本地阶段推测下一步。已投递/待处理 → APPLIED；简历筛选 → SCREENING；测评 → ASSESSMENT；笔试/机试 → OA；一面/初面/群面/业务面 → INTERVIEW_1；二面/复试 → INTERVIEW_2；三面/终面 → INTERVIEW_3；HR 面 → HR_INTERVIEW；已发 Offer/待签约 → OFFER；未录用/未通过/已淘汰/流程终止/感谢参与 → REJECTED。看不出类别填 null，不要猜；仅仅长时间无消息或岗位下架不等于淘汰。
5. confident：只表示"这条官网记录确实对应哪个 applicationId"有把握；即使不能映射到标准阶段，也要保留原始 portalStatus、stage 填 null，不能让官网状态消失。

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

async function syncOne(portal: {
  id: string;
  url: string;
  contentHash: string | null;
  company: { id: string; name: string };
}, force = false): Promise<{
  status: "changed" | "unchanged" | "skipped";
  changes: PortalSyncChange[];
  review: PortalSyncReview[];
  matched: PortalSyncMatch[];
  unmatched: PortalSyncUnmatched[];
}> {
  const company = portal.company;

  const companyApplications = await db.application.findMany({
    where: { companyId: company.id, userId: LOCAL_USER_ID, currentStage: { notIn: TERMINAL_STAGES } },
    select: { id: true, title: true, currentStage: true, portalId: true },
  });
  const applications = companyApplications.filter((app) => portalOwnsApplication(portal.id, app.portalId));
  // Nothing in flight at this company — no point loading the page.
  if (applications.length === 0) return { status: "skipped", changes: [], review: [], matched: [], unmatched: [] };

  const text = (await renderPageText(portal.url, { useApplicationSession: true })).trim();
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
  if (!force && hash === portal.contentHash) {
    await db.applicationPortal.update({
      where: { id: portal.id },
      data: { lastCheckedAt: new Date(), lastSuccessfulAt: new Date(), lastError: null },
    });
    return { status: "unchanged", changes: [], review: [], matched: [], unmatched: [] };
  }

  const extraction = await extractStatuses(text.slice(0, PAGE_TEXT_CAP), company.name, applications);
  if (extraction.needsLogin) {
    // Don't store the hash: once the user logs back in the page will differ
    // anyway, and we want the next check to actually read it.
    throw new Error("登录已过期——去网申浏览器重新登录这家公司的招聘系统");
  }

  const now = new Date();
  const changes: PortalSyncChange[] = [];
  const review: PortalSyncReview[] = [];
  const matched: PortalSyncMatch[] = [];
  const matchedIds = new Set<string>();
  for (const entry of extraction.entries) {
    const app = applications.find((a) => a.id === entry.applicationId);
    if (!app || !entry.confident) continue;
    // A malformed model response should not make one local application count
    // as several matches or write its portal status repeatedly.
    if (matchedIds.has(app.id)) continue;
    const portalStatus = entry.portalStatus.trim().slice(0, 100);
    if (!portalStatus) continue;
    matchedIds.add(app.id);
    matched.push({
      companyName: company.name,
      applicationId: app.id,
      title: app.title,
      portalStatus,
    });
    const next = isExplicitRejectionStatus(portalStatus)
      ? "REJECTED"
      : SYNCABLE_STAGES.find((s) => s === entry.stage) ?? null;

    await db.$transaction(async (tx) => {
      // Terminal outcomes and non-standard ordering always require a human
      // check. A company may run HR first or add an OA after interviews;
      // silently treating that as a regression would be wrong.
      const transition = classifyPortalTransition(app.currentStage, next);
      const requiresReview = transition === "review";
      await tx.application.update({
        where: { id: app.id },
        data: {
          portalStatus,
          portalStatusAt: now,
          ...(requiresReview ? { portalSuggestedStage: next, portalSuggestedAt: now } :
            transition === "apply" ? { portalSuggestedStage: null, portalSuggestedAt: null } : {}),
        },
      });
      if (requiresReview && next) {
        review.push({ companyName: company.name, applicationId: app.id, title: app.title, from: app.currentStage, to: next, portalStatus });
        return;
      }
      if (!next || transition !== "apply") return;
      await tx.stageHistory.create({
        data: {
          applicationId: app.id,
          stage: next,
          stageLabel: portalStatus,
          enteredAt: now,
          note: `${PORTAL_SYNC_NOTE_PREFIX}：官网显示「${portalStatus}」`,
        },
      });
      await tx.application.update({
        where: { id: app.id },
        data: { currentStage: next, currentStageLabel: portalStatus, currentStageDate: now },
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

  await db.applicationPortal.update({
    where: { id: portal.id },
    data: { contentHash: hash, lastCheckedAt: now, lastSuccessfulAt: now, lastError: null },
  });
  return {
    status: "changed",
    changes,
    review,
    matched,
    unmatched: applications
      .filter((a) => !matchedIds.has(a.id))
      .map((a) => ({ companyName: company.name, applicationId: a.id, title: a.title })),
  };
}

async function runSync(portalIds?: string[], force = false): Promise<PortalSyncResult> {
  const portals = await db.applicationPortal.findMany({
    where: portalIds ? { id: { in: portalIds } } : undefined,
    select: { id: true, url: true, contentHash: true, company: { select: { id: true, name: true } } },
  });

  const result: PortalSyncResult = {
    checked: 0,
    skipped: 0,
    changed: [],
    review: [],
    matched: [],
    unmatched: [],
    unassigned: [],
    unchanged: [],
    errors: [],
  };
  const portalCompanyIds = [...new Set(portals.map((portal) => portal.company.id))];
  if (portalCompanyIds.length > 0) {
    const unassigned = await db.application.findMany({
      where: { userId: LOCAL_USER_ID, companyId: { in: portalCompanyIds }, portalId: null, currentStage: { notIn: TERMINAL_STAGES } },
      select: { id: true, title: true, company: { select: { name: true } } },
    });
    result.unassigned = unassigned.map((app) => ({ companyName: app.company.name, applicationId: app.id, title: app.title }));
  }
  // Sequential on purpose: each check may open a hidden window and make an
  // AI call, and the render bridge already caps concurrency at 2.
  for (const portal of portals) {
    try {
      const outcome = await syncOne(portal, force);
      if (outcome.status === "skipped") result.skipped++;
      else {
        result.checked++;
        if (outcome.status === "unchanged") result.unchanged.push(portal.company.name);
      }
      result.changed.push(...outcome.changes);
      result.review.push(...outcome.review);
      result.matched.push(...outcome.matched);
      result.unmatched.push(...outcome.unmatched);
    } catch (err) {
      const message = err instanceof Error ? err.message : "同步失败";
      result.errors.push({ companyName: portal.company.name, message });
      await db.applicationPortal.update({
        where: { id: portal.id },
        data: { lastCheckedAt: new Date(), lastError: message },
      });
    }
  }

  if (result.matched.length > 0 || result.changed.length > 0 || result.review.length > 0 || result.errors.length > 0) {
    revalidatePath("/applications");
    revalidatePath("/dashboard");
    for (const id of new Set(result.matched.map((item) => item.applicationId))) revalidatePath(`/applications/${id}`);
  }
  revalidatePath("/browser");
  return result;
}

/** Called by the desktop app's background timer (src/app/api/application-sync/check). */
export async function syncAllPortals(): Promise<PortalSyncResult> {
  return runSync();
}

export async function syncPortalsNow(
  portalId?: string,
  force = false
): Promise<ActionResult<PortalSyncResult>> {
  return toActionResult(async () => {
    await requireUser();
    return runSync(portalId ? [portalId] : undefined, force);
  });
}

/** Offer/rejection extracted from a portal needs the user's own decision. */
export async function resolvePortalStageSuggestion(applicationId: string, accept: boolean): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const application = await db.application.findFirst({
      where: { id: applicationId, userId: user.id },
      select: { id: true, currentStage: true, portalSuggestedStage: true, portalSuggestedAt: true, portalStatus: true },
    });
    if (!application?.portalSuggestedStage) throw new UserFacingError("这条官网建议已处理或不存在");
    if (accept && (TERMINAL_STAGES.includes(application.currentStage) ||
      application.currentStage === application.portalSuggestedStage)) {
      throw new UserFacingError("投递阶段已变化，请刷新后核对");
    }
    await db.$transaction(async (tx) => {
      const updated = await tx.application.updateMany({
        where: {
          id: applicationId,
          userId: user.id,
          currentStage: application.currentStage,
          portalSuggestedStage: application.portalSuggestedStage,
        },
        data: {
          portalSuggestedStage: null,
          portalSuggestedAt: null,
          ...(accept ? { currentStage: application.portalSuggestedStage!, currentStageLabel: application.portalStatus, currentStageDate: application.portalSuggestedAt ?? new Date() } : {}),
        },
      });
      if (updated.count !== 1) throw new UserFacingError("官网建议已变化，请刷新后核对");
      if (accept) {
        await tx.stageHistory.create({
          data: {
            applicationId,
            stage: application.portalSuggestedStage!,
            stageLabel: application.portalStatus,
            enteredAt: application.portalSuggestedAt ?? new Date(),
            note: `${PORTAL_SYNC_NOTE_PREFIX}（已核对）：官网显示「${application.portalStatus ?? ""}」`,
          },
        });
      }
    });
    revalidatePath("/applications");
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/dashboard");
    return null;
  });
}
