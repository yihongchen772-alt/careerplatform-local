"use server";
import { terminationFields } from "@/lib/termination";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { applicationStageValues } from "@/lib/validation";
import { computeInterestScore } from "@/lib/scoring";
import { resolveCompanyId } from "@/lib/company-resolver";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { markPositionsApplied, deletePosition } from "@/lib/actions/positions";
import { deleteApplication, updateApplication } from "@/lib/actions/applications";
import { toggleTaskDone } from "@/lib/actions/personal-tasks";
import { markContacted } from "@/lib/actions/contacts";
import { revalidateContactPaths } from "@/lib/revalidate-contacts";
import { addCalendarItem, addStageSchedule, markFollowedUp, saveStepNote, setEventCompleted, setStageSchedule, setStepCompleted, writeMailSchedule } from "@/lib/actions/schedule";
import { assistantActionSchema, type AssistantAction } from "@/lib/assistant-shared";
import { parseCities } from "@/lib/application-city";
import { closestId } from "@/lib/closest-id";
import { currentStageRow, isTerminalStage } from "@/lib/interview-schedule";

/**
 * Resolves a 投递 for an action: exact ID, then a 1-2 char miscopied ID
 * (`closestId`), then by companyName (+ title) when only one matches.
 */
async function findApplicationForAction(userId: string, targetId?: string | null, companyName?: string | null, title?: string | null) {
  const id = targetId?.trim() || "";
  if (id) {
    const exact = await db.application.findFirst({ where: { id, userId }, include: { company: { select: { name: true } } } });
    if (exact) return exact;
    const allIds = (await db.application.findMany({ where: { userId }, select: { id: true } })).map((row) => row.id);
    const fixed = closestId(id, allIds);
    if (fixed) {
      const matched = await db.application.findFirst({ where: { id: fixed, userId }, include: { company: { select: { name: true } } } });
      if (matched) return matched;
    }
  }
  const company = (companyName?.trim() || (!/^c[a-z0-9]{15,}$/i.test(id) ? id : "")).toLowerCase();
  if (!company) return null;
  const candidates = await db.application.findMany({
    where: { userId },
    include: { company: { include: { aliases: { select: { alias: true } } } } },
    orderBy: { appliedDate: "desc" },
  });
  const byCompany = candidates.filter((app) =>
    [app.company.name, ...app.company.aliases.map((a) => a.alias)].some((n) => n.toLowerCase().includes(company) || company.includes(n.toLowerCase()))
  );
  if (!byCompany.length) return null;
  const wantedTitle = title?.trim().toLowerCase();
  if (wantedTitle) {
    const byTitle = byCompany.filter((app) => app.title.toLowerCase().includes(wantedTitle) || wantedTitle.includes(app.title.toLowerCase()));
    if (byTitle.length === 1) return byTitle[0];
  }
  if (byCompany.length === 1) return byCompany[0];
  const active = byCompany.filter((app) => !isTerminalStage(app.currentStage));
  return active.length === 1 ? active[0] : null;
}

/**
 * One step of a 投递, owned by this user, for the step actions. Falls back to
 * closestId on StageHistory, or if the model passed an Application ID /
 * companyName instead of a StageHistory ID, resolves that application's current step.
 */
async function stepRow(userId: string, id: string | null | undefined, companyName?: string | null, stage?: string | null) {
  const select = { id: true, stage: true, note: true, meetingInfo: true, remindMinutes: true, enteredAt: true, application: { select: { id: true, company: { select: { name: true } } } } } as const;
  const rawId = id?.trim() || "";
  if (rawId) {
    const exact = await db.stageHistory.findFirst({ where: { id: rawId, application: { userId } }, select });
    if (exact) return exact;
    const allStageIds = (await db.stageHistory.findMany({ where: { application: { userId } }, select: { id: true } })).map((r) => r.id);
    const fixedStage = closestId(rawId, allStageIds);
    if (fixedStage) {
      const matched = await db.stageHistory.findFirst({ where: { id: fixedStage, application: { userId } }, select });
      if (matched) return matched;
    }
  }
  // Model passed [投递ID] or companyName instead of [进度ID]: resolve to that 投递's current step.
  const app = await findApplicationForAction(userId, rawId, companyName);
  if (app) {
    const rows = await db.stageHistory.findMany({ where: { applicationId: app.id }, orderBy: { enteredAt: "asc" }, select });
    const byStage = stage ? [...rows].reverse().find((r) => r.stage === stage) : null;
    const picked = byStage ?? currentStageRow(app, rows);
    if (picked) return picked;
  }
  if (!rawId && !companyName) throw new UserFacingError("没指明是哪一轮，到投递详情里操作吧");
  throw new UserFacingError("找不到这一轮的记录，可能已经改过了，刷新一下再说");
}

async function findPositionForAction(userId: string, targetId?: string | null, companyName?: string | null, title?: string | null) {
  const id = targetId?.trim() || "";
  if (id) {
    const exact = await db.position.findFirst({ where: { id, userId }, include: { company: true } });
    if (exact) return exact;
    const allIds = (await db.position.findMany({ where: { userId }, select: { id: true } })).map((r) => r.id);
    const fixed = closestId(id, allIds);
    if (fixed) {
      const matched = await db.position.findFirst({ where: { id: fixed, userId }, include: { company: true } });
      if (matched) return matched;
    }
  }
  const company = companyName?.trim().toLowerCase();
  if (!company) return null;
  const candidates = await db.position.findMany({ where: { userId }, include: { company: true }, orderBy: { createdAt: "desc" } });
  const byCompany = candidates.filter((p) => p.company.name.toLowerCase().includes(company) || company.includes(p.company.name.toLowerCase()));
  if (!byCompany.length) return null;
  const wantedTitle = title?.trim().toLowerCase();
  if (wantedTitle) {
    const byTitle = byCompany.filter((p) => p.title.toLowerCase().includes(wantedTitle) || wantedTitle.includes(p.title.toLowerCase()));
    if (byTitle.length === 1) return byTitle[0];
  }
  return byCompany.length === 1 ? byCompany[0] : null;
}

/**
 * 「2026-10-21T15:00」 → a time; 「2026-10-21」 → that day (stored as UTC
 * midnight, like every date-only value). Read in this computer's time zone.
 */
function scheduleTime(raw: string | null | undefined, rawEnd: string | null | undefined) {
  const value = raw?.trim() ?? "";
  const timed = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!timed && !dateOnly) throw new UserFacingError("没认出具体时间，到投递详情里添加吧");
  const start = timed ? new Date(value.replace(" ", "T")) : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new UserFacingError("时间格式不对");
  const endValue = rawEnd?.trim() ?? "";
  const end = endValue && /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(endValue) && timed ? new Date(endValue.replace(" ", "T")) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = timed ? `${start.getMonth() + 1}月${start.getDate()}日 ${pad(start.getHours())}:${pad(start.getMinutes())}` : `${start.getUTCMonth() + 1}月${start.getUTCDate()}日`;
  return { nextDeadline: start, nextDeadlineEnd: end && end.getTime() > start.getTime() ? end : null, nextHasTime: timed, label };
}

/** An http(s) link, or nothing. */
function webUrl(raw: string | null | undefined): string | null {
  try {
    const url = new URL(raw?.trim() ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.slice(0, 2000) : null;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD (or anything Date can parse) -> Date, or null. */
function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizePositionStatus(input: string | null | undefined): "EVALUATING" | "PLANNED" | "DROPPED" | undefined {
  if (!input?.trim()) return undefined;
  const raw = input.trim().toUpperCase();
  if (raw === "EVALUATING" || raw.includes("评估")) return "EVALUATING";
  if (raw === "PLANNED" || raw === "TO_APPLY" || raw.includes("计划") || raw.includes("待投")) return "PLANNED";
  if (raw === "DROPPED" || raw.includes("放弃")) return "DROPPED";
  return undefined;
}

/**
 * Executes one proposed action after the user has clicked it. Everything is
 * re-validated here rather than trusted from the model's output — the client
 * round-trip means the payload is user-controlled either way, and a
 * hallucinated 投递ID must not be able to touch another user's row (hence
 * the userId filter on every lookup).
 */
export async function applyAssistantAction(
  action: AssistantAction
): Promise<ActionResult<{ done: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const a = assistantActionSchema.parse(action);

    switch (a.type) {
      case "add_task": {
        // Models routinely put the whole task into `label` (the button text)
        // and leave `title` null — measured on Qwen with "设一面提醒：…".
        // The label reads fine as a task title, so fall back to it rather
        // than leaving the user with a button that only ever errors.
        const title = a.title?.trim() || a.label.trim();
        if (!title) throw new UserFacingError("这条待办没有标题，改成手动添加吧");
        await db.personalTask.create({
          data: {
            userId: user.id,
            title,
            note: a.note || undefined,
            dueDate: parseDate(a.date) ?? undefined,
            dueDateEnd: parseDate(a.dateEnd) ?? undefined,
          },
        });
        revalidatePath("/dashboard");
        revalidatePath("/calendar");
        return { done: `已加待办：${title}` };
      }

      case "log_application": {
        if (!a.companyName || !a.title) {
          throw new UserFacingError("公司或岗位名没给全，改成手动添加吧");
        }
        const appliedDate = parseDate(a.date) ?? new Date();
        const companyId = await resolveCompanyId(a.companyName, { aiUserId: user.id });
        const cities = parseCities(a.city);
        const city = cities.length ? cities.slice(0, 12).join("、") : undefined;
        await db.$transaction(async (tx) => {
          const created = await tx.application.create({
            data: {
              userId: user.id,
              companyId,
              title: a.title!,
              appliedDate,
              source: a.note || undefined,
              ...(city ? { city, citySource: null, cityLookupAt: new Date() } : {}),
              currentStage: "APPLIED",
              currentStageDate: appliedDate,
            },
          });
          await tx.stageHistory.create({
            data: { applicationId: created.id, stage: "APPLIED", enteredAt: appliedDate },
          });
        });
        revalidatePath("/applications");
        revalidatePath("/dashboard");
        return { done: `已记录投递：${a.companyName} · ${a.title}${city ? `（${city}）` : ""}` };
      }

      case "add_position": {
        if (!a.companyName || !a.title) {
          throw new UserFacingError("公司或岗位名没给全，改成手动添加吧");
        }
        const companyId = await resolveCompanyId(a.companyName, { aiUserId: user.id });
        const cities = parseCities(a.city);
        await db.position.create({
          data: {
            userId: user.id,
            companyId,
            title: a.title,
            location: cities.length ? cities.join("、") : undefined,
            salaryMin: a.salaryMin ?? undefined,
            salaryMax: a.salaryMax ?? undefined,
            deadline: parseDate(a.date) ?? undefined,
            jdText: a.note || undefined,
            jdUrl: webUrl(a.url) ?? undefined,
            source: "小欧",
            status: normalizePositionStatus(a.positionStatus) ?? "EVALUATING",
            interestScore: computeInterestScore(undefined),
          },
        });
        revalidatePath("/pool");
        revalidatePath("/dashboard");
        return { done: `已加入候选池：${a.companyName} · ${a.title}` };
      }

      case "update_stage": {
        const stage = applicationStageValues.find((s) => s === a.stage);
        if (!stage) throw new UserFacingError("阶段名没认出来，改成手动更新吧");
        const application = await findApplicationForAction(user.id, a.targetId, a.companyName, a.title);
        if (!application) throw new UserFacingError("找不到这条投递记录，改成手动更新吧");
        const cities = parseCities(a.city);
        await db.$transaction(async (tx) => {
          await tx.stageHistory.create({
            data: {
              applicationId: application.id,
              stage,
              ...terminationFields(stage, application.currentStage, application.currentStageLabel),
              note: a.note || undefined,
              nextDeadline: parseDate(a.date) ?? undefined,
              nextDeadlineEnd: parseDate(a.dateEnd) ?? undefined,
            },
          });
          await tx.application.update({
            where: { id: application.id },
            data: {
              currentStage: stage,
              currentStageDate: new Date(),
              ...(cities.length ? { city: cities.slice(0, 12).join("、"), citySource: null, cityLookupAt: new Date() } : {}),
            },
          });
        });
        revalidatePath(`/applications/${application.id}`);
        revalidatePath("/applications");
        revalidatePath("/dashboard");
        return { done: `已将 ${application.company.name} · ${application.title} 更新为${STAGE_LABELS[stage]}` };
      }

      case "promote_lead": {
        if (!a.targetId) throw new UserFacingError("没指明是哪条线索，改成手动操作吧");
        const lead = await db.jobLead.findFirst({
          where: { id: a.targetId, userId: user.id },
        });
        if (!lead) throw new UserFacingError("找不到这条线索");
        if (lead.promotedPositionId) {
          throw new UserFacingError("这条已经在候选池里了");
        }
        const companyId = await resolveCompanyId(lead.companyName, { aiUserId: user.id });
        const position = await db.position.create({
          data: {
            userId: user.id,
            companyId,
            title: lead.title,
            track: lead.track ?? undefined,
            department: lead.department ?? undefined,
            location: lead.location ?? undefined,
            salaryMin: lead.salaryMin ?? undefined,
            salaryMax: lead.salaryMax ?? undefined,
            deadline: lead.deadline ?? undefined,
            jdUrl: lead.jdUrl ?? undefined,
            source: lead.source ?? "秋招信息库",
            jdText: lead.note ?? undefined,
            status: "EVALUATING",
            interestScore: computeInterestScore(undefined),
          },
        });
        await db.jobLead.update({
          where: { id: lead.id },
          data: { promotedPositionId: position.id },
        });
        revalidatePath("/pool");
        revalidatePath("/leads");
        revalidatePath("/dashboard");
        return { done: `已提入候选池：${lead.companyName} · ${lead.title}` };
      }

      case "add_contact": {
        const name = a.contactName?.trim() || a.label.trim();
        if (!name) throw new UserFacingError("没认出联系人姓名，改成手动添加吧");
        await db.contact.create({
          data: {
            userId: user.id,
            name,
            role: a.title || undefined,
            companyName: a.companyName || undefined,
            note: a.note || undefined,
            nextFollowUpAt: parseDate(a.date) ?? undefined,
          },
        });
        revalidateContactPaths();
        return { done: `已加联系人：${name}` };
      }

      case "mark_position_applied": {
        const position = await findPositionForAction(user.id, a.targetId, a.companyName, a.title);
        if (!position) throw new UserFacingError("找不到这个候选岗位，改成手动标记吧");
        await markPositionsApplied([position.id], {
          appliedDate: parseDate(a.date) ?? new Date(),
          referrer: a.contactName || undefined,
          source: a.note || undefined,
        });
        return { done: `已标记为已投递：${position.company.name} · ${position.title}` };
      }

      case "update_application": {
        const application = await findApplicationForAction(user.id, a.targetId, a.companyName, a.title);
        if (!application) throw new UserFacingError("找不到这条投递记录，改成手动修改吧");
        const cities = parseCities(a.city);
        await updateApplication(application.id, {
          appliedDate: parseDate(a.date) ?? application.appliedDate,
          referrer: a.contactName || undefined,
          source: a.note || undefined,
          ...(cities.length ? { city: cities.slice(0, 12).join("、") } : {}),
        });
        return { done: `已更新投递信息：${application.company.name} · ${application.title}` };
      }

      case "delete_position": {
        const position = await findPositionForAction(user.id, a.targetId, a.companyName, a.title);
        if (!position) throw new UserFacingError("找不到这个候选岗位，改成手动删除吧");
        await deletePosition(position.id);
        return { done: `已删除候选岗位：${position.title}` };
      }

      case "withdraw_application": {
        const application = await findApplicationForAction(user.id, a.targetId, a.companyName, a.title);
        if (!application) throw new UserFacingError("找不到这条投递记录，改成手动删除吧");
        await deleteApplication(application.id);
        return { done: `已删除投递记录：${application.title}` };
      }

      case "complete_task": {
        const id = a.targetId?.trim() || "";
        let task = id ? await db.personalTask.findFirst({ where: { id, userId: user.id } }) : null;
        if (!task && id) {
          const allIds = (await db.personalTask.findMany({ where: { userId: user.id }, select: { id: true } })).map((t) => t.id);
          const fixed = closestId(id, allIds);
          if (fixed) task = await db.personalTask.findFirst({ where: { id: fixed, userId: user.id } });
        }
        if (!task && a.title?.trim()) {
          task = await db.personalTask.findFirst({ where: { userId: user.id, done: false, title: { contains: a.title.trim() } } });
        }
        if (!task) throw new UserFacingError("找不到这条待办，改成手动完成吧");
        await toggleTaskDone(task.id, true);
        return { done: `已完成待办：${task.title}` };
      }

      case "set_schedule": {
        const application = await findApplicationForAction(user.id, a.targetId, a.companyName, a.title);
        if (!application) throw new UserFacingError("找不到这条投递记录，到投递详情里添加时间吧");
        const when = scheduleTime(a.date, a.dateEnd);
        const stage = applicationStageValues.find((value) => value === a.stage) ?? application.currentStage;
        const result = await addStageSchedule(application.id, stage, { ...when, meetingInfo: a.note?.trim() || null });
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已记下 ${application.company.name} ${STAGE_LABELS[stage]}：${when.label}` };
      }

      case "reschedule": {
        const row = await stepRow(user.id, a.targetId, a.companyName, a.stage);
        const when = scheduleTime(a.date, a.dateEnd);
        const result = await setStageSchedule(row.id, { ...when, meetingInfo: a.note?.trim() || row.meetingInfo, remindMinutes: row.remindMinutes });
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已改到 ${when.label}：${row.application.company.name} ${STAGE_LABELS[row.stage]}` };
      }

      case "complete_step": {
        const row = await stepRow(user.id, a.targetId, a.companyName, a.stage);
        const result = await setStepCompleted(row.id, true);
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已标记完成：${row.application.company.name} ${STAGE_LABELS[row.stage]}，开始等结果` };
      }

      case "save_note": {
        const row = await stepRow(user.id, a.targetId, a.companyName, a.stage);
        const text = a.note?.trim();
        if (!text) throw new UserFacingError("没有要记的内容");
        // Added below what is already there, never in its place.
        const result = await saveStepNote(row.id, row.note?.trim() ? `${row.note.trim()}\n\n${text}` : text);
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已记到 ${row.application.company.name} ${STAGE_LABELS[row.stage]} 的复盘里` };
      }

      case "mark_followed_up": {
        const row = await stepRow(user.id, a.targetId, a.companyName, a.stage);
        const result = await markFollowedUp(row.id);
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已记下跟进过：${row.application.company.name}` };
      }

      case "mark_contacted": {
        const id = a.targetId?.trim() || "";
        let contact = id ? await db.contact.findFirst({ where: { id, userId: user.id } }) : null;
        if (!contact && id) {
          const allIds = (await db.contact.findMany({ where: { userId: user.id }, select: { id: true } })).map((c) => c.id);
          const fixed = closestId(id, allIds);
          if (fixed) contact = await db.contact.findFirst({ where: { id: fixed, userId: user.id } });
        }
        if (!contact && a.contactName?.trim()) {
          contact = await db.contact.findFirst({ where: { userId: user.id, name: { contains: a.contactName.trim() } } });
        }
        if (!contact) throw new UserFacingError("找不到这个联系人，改成手动操作吧");
        await markContacted(contact.id);
        return { done: `已记录联系：${contact.name}` };
      }

      case "set_city": {
        const cities = parseCities(a.city ?? a.note);
        if (!cities.length) throw new UserFacingError("没认出城市名，到投递里手动改吧");
        const application = (a.targetId ? await db.application.findFirst({ where: { id: a.targetId, userId: user.id }, include: { company: true } }) : null)
          ?? await findApplicationForAction(user.id, a.targetId, a.companyName, a.title);
        if (!application) throw new UserFacingError("找不到这条投递记录");
        const city = cities.slice(0, 12).join("、");
        // Confirmed by the user, so no longer a guess: it shows like one typed in.
        await db.application.update({ where: { id: application.id }, data: { city, citySource: null, cityLookupAt: new Date() } });
        revalidatePath("/applications");
        return { done: `${application.company.name} · ${application.title} 的城市记为 ${city}` };
      }

      case "update_offer": {
        const application = await findApplicationForAction(user.id, a.targetId, a.companyName, a.title);
        if (!application) throw new UserFacingError("找不到这条投递记录，到投递详情里填写 Offer 信息吧");
        const cities = parseCities(a.city);
        const data: Record<string, unknown> = {};
        if (a.salaryMin != null) data.salaryMin = a.salaryMin;
        if (a.salaryMax != null) data.salaryMax = a.salaryMax;
        if (a.offerAnnualTotal != null) data.offerAnnualTotal = a.offerAnnualTotal;
        if (a.commuteMinutes != null) data.commuteMinutes = a.commuteMinutes;
        if (a.overtimeNote?.trim()) data.overtimeNote = a.overtimeNote.trim().slice(0, 300);
        if (a.growthNote?.trim()) data.growthNote = a.growthNote.trim().slice(0, 300);
        if (a.note?.trim()) data.offerNote = a.note.trim().slice(0, 1000);
        if (cities.length) {
          data.city = cities.slice(0, 12).join("、");
          data.citySource = null;
          data.cityLookupAt = new Date();
        }
        if (!Object.keys(data).length) throw new UserFacingError("没有要保存的薪资或 Offer 信息");
        await db.application.update({ where: { id: application.id }, data });
        revalidatePath(`/applications/${application.id}`);
        revalidatePath("/applications");
        revalidatePath("/dashboard");
        revalidatePath("/insights");
        return { done: `已更新 Offer 信息：${application.company.name} · ${application.title}` };
      }

      case "update_position": {
        const position = await findPositionForAction(user.id, a.targetId, a.companyName, a.title);
        if (!position) throw new UserFacingError("找不到这个候选岗位，到候选池里修改吧");
        const cities = parseCities(a.city);
        const data: Record<string, unknown> = {};
        const status = normalizePositionStatus(a.positionStatus);
        if (status) data.status = status;
        if (cities.length) data.location = cities.join("、");
        else if (a.city?.trim()) data.location = a.city.trim().slice(0, 60);
        const deadline = parseDate(a.date);
        if (deadline) data.deadline = deadline;
        if (a.salaryMin != null) data.salaryMin = a.salaryMin;
        if (a.salaryMax != null) data.salaryMax = a.salaryMax;
        if (a.note?.trim()) data.jdText = a.note.trim().slice(0, 10000);
        const url = webUrl(a.url);
        if (url) data.jdUrl = url;
        if (!Object.keys(data).length) throw new UserFacingError("没有要更新的岗位字段");
        await db.position.update({ where: { id: position.id }, data });
        revalidatePath("/pool");
        revalidatePath("/dashboard");
        return { done: `已更新候选岗位：${position.company.name} · ${position.title}` };
      }

      case "add_calendar_event": {
        const title = (a.title?.trim() || a.label.trim()).slice(0, 200);
        if (!title) throw new UserFacingError("请提供日程标题");
        const when = scheduleTime(a.date, a.dateEnd);
        const result = await addCalendarItem(title, {
          nextDeadline: when.nextDeadline,
          nextDeadlineEnd: when.nextDeadlineEnd,
          nextHasTime: when.nextHasTime,
          meetingInfo: a.note?.trim() || null,
          remindMinutes: when.nextHasTime ? 30 : null,
        });
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已加入日历：${title}（${when.label}）` };
      }

      case "complete_calendar_event": {
        const id = a.targetId?.trim() || "";
        if (!id) throw new UserFacingError("没指明是哪条日程，到日历里操作吧");
        let event = await db.calendarEvent.findFirst({ where: { id, userId: user.id, stageHistoryId: null } });
        if (!event) {
          const allEventIds = (await db.calendarEvent.findMany({ where: { userId: user.id, stageHistoryId: null }, select: { id: true } })).map((e) => e.id);
          const fixed = closestId(id, allEventIds);
          if (fixed) event = await db.calendarEvent.findFirst({ where: { id: fixed, userId: user.id, stageHistoryId: null } });
        }
        if (event) {
          const result = await setEventCompleted(event.id, true);
          if (!result.ok) throw new UserFacingError(result.message);
          return { done: `已标记日程完成：${event.title}` };
        }
        // Check if targetId is a pending mail schedule task ID.
        let mailTask = await db.personalTask.findFirst({ where: { id, userId: user.id } });
        if (!mailTask) {
          const allTaskIds = (await db.personalTask.findMany({ where: { userId: user.id }, select: { id: true } })).map((t) => t.id);
          const fixedTask = closestId(id, allTaskIds);
          if (fixedTask) mailTask = await db.personalTask.findFirst({ where: { id: fixedTask, userId: user.id } });
        }
        if (mailTask) {
          const result = await writeMailSchedule(mailTask.id);
          if (!result.ok) throw new UserFacingError(result.message);
          return { done: `已将邮件日程写入日历：${mailTask.title}` };
        }
        throw new UserFacingError("找不到这条日程或邮件待办，请刷新后再试");
      }

      case "update_profile": {
        const data: Record<string, unknown> = {};
        if (a.title?.trim()) data.targetTrack = a.title.trim().slice(0, 120);
        if (a.city?.trim()) data.preferredCities = a.city.trim().slice(0, 120);
        if (a.salaryMin != null) data.expectedSalaryMin = a.salaryMin;
        if (a.note?.trim()) data.skills = a.note.trim().slice(0, 500);
        if (!Object.keys(data).length) throw new UserFacingError("没有要更新的求职偏好字段");
        await db.user.update({ where: { id: user.id }, data });
        revalidatePath("/settings");
        revalidatePath("/dashboard");
        return { done: "已更新个人求职偏好" };
      }

      case "update_company_industry": {
        const companyName = a.companyName?.trim();
        const industry = (a.title || a.note || "").trim().slice(0, 40);
        if (!companyName || !industry) throw new UserFacingError("请提供公司名和行业分类");
        const companyId = await resolveCompanyId(companyName, { aiUserId: user.id });
        await db.company.update({ where: { id: companyId }, data: { industry } });
        revalidatePath("/applications");
        revalidatePath("/companies");
        return { done: `已将 ${companyName} 的行业设为「${industry}」` };
      }

      case "add_journey": {
        const text = (a.note || a.title || "").trim().slice(0, 2000);
        if (!text) throw new UserFacingError("没有要记录的心路历程内容");
        const about = (a.companyName && a.title && a.note ? `${a.companyName.trim()} · ${a.title.trim()}` : (a.companyName || (a.note ? a.title : null))?.trim())?.slice(0, 80) || null;
        const rawMood = (a.mood ?? "").trim().toLowerCase();
        const mood =
          rawMood === "happy" || /开心|高兴|突破|顺利|激动|喜/.test(rawMood) ? "happy"
          : rawMood === "down" || /低落|沮丧|焦虑|累|疲|失落/.test(rawMood) ? "down"
          : rawMood === "angry" || /生气|愤怒|无语|烦/.test(rawMood) ? "angry"
          : rawMood === "cry" || /难过|哭|崩溃|伤心/.test(rawMood) ? "cry"
          : "ok";
        await db.journeyEntry.create({
          data: {
            userId: user.id,
            mood,
            text,
            about,
          },
        });
        revalidatePath("/journey");
        revalidatePath("/dashboard");
        return { done: `已记入心路历程${about ? `（${about}）` : ""}` };
      }
    }
  });
}
