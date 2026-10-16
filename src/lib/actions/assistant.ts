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
import { addStageSchedule, markFollowedUp, saveStepNote, setStageSchedule, setStepCompleted } from "@/lib/actions/schedule";
import { assistantActionSchema, type AssistantAction } from "@/lib/assistant-shared";

/** One step of a 投递, owned by this user, for the step actions. */
async function stepRow(userId: string, id: string | null | undefined) {
  if (!id) throw new UserFacingError("没指明是哪一轮，到投递详情里操作吧");
  const row = await db.stageHistory.findFirst({
    where: { id, application: { userId } },
    select: { id: true, stage: true, note: true, meetingInfo: true, remindMinutes: true, application: { select: { company: { select: { name: true } } } } },
  });
  if (!row) throw new UserFacingError("找不到这一轮的记录，可能已经改过了，刷新一下再说");
  return row;
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
        await db.$transaction(async (tx) => {
          const created = await tx.application.create({
            data: {
              userId: user.id,
              companyId,
              title: a.title!,
              appliedDate,
              source: a.note || undefined,
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
        return { done: `已记录投递：${a.companyName} · ${a.title}` };
      }

      case "add_position": {
        if (!a.companyName || !a.title) {
          throw new UserFacingError("公司或岗位名没给全，改成手动添加吧");
        }
        const companyId = await resolveCompanyId(a.companyName, { aiUserId: user.id });
        await db.position.create({
          data: {
            userId: user.id,
            companyId,
            title: a.title,
            deadline: parseDate(a.date) ?? undefined,
            jdText: a.note || undefined,
            jdUrl: webUrl(a.url) ?? undefined,
            source: "小欧",
            status: "EVALUATING",
            interestScore: computeInterestScore(undefined),
          },
        });
        revalidatePath("/pool");
        revalidatePath("/dashboard");
        return { done: `已加入候选池：${a.companyName} · ${a.title}` };
      }

      case "update_stage": {
        if (!a.targetId) throw new UserFacingError("没指明是哪条投递，改成手动更新吧");
        const stage = applicationStageValues.find((s) => s === a.stage);
        if (!stage) throw new UserFacingError("阶段名没认出来，改成手动更新吧");
        const application = await db.application.findFirst({
          where: { id: a.targetId, userId: user.id },
        });
        if (!application) throw new UserFacingError("找不到这条投递记录");
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
            data: { currentStage: stage, currentStageDate: new Date() },
          });
        });
        revalidatePath(`/applications/${application.id}`);
        revalidatePath("/applications");
        revalidatePath("/dashboard");
        return { done: `已更新为${STAGE_LABELS[stage]}` };
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
        if (!a.targetId) throw new UserFacingError("没指明是哪个候选岗位，改成手动标记吧");
        const position = await db.position.findFirst({
          where: { id: a.targetId, userId: user.id },
          include: { company: true },
        });
        if (!position) throw new UserFacingError("找不到这个候选岗位");
        await markPositionsApplied([position.id], {
          appliedDate: parseDate(a.date) ?? new Date(),
          referrer: a.contactName || undefined,
          source: a.note || undefined,
        });
        return { done: `已标记为已投递：${position.company.name} · ${position.title}` };
      }

      case "update_application": {
        if (!a.targetId) throw new UserFacingError("没指明是哪条投递，改成手动修改吧");
        const application = await db.application.findFirst({
          where: { id: a.targetId, userId: user.id },
        });
        if (!application) throw new UserFacingError("找不到这条投递记录");
        await updateApplication(application.id, {
          appliedDate: parseDate(a.date) ?? application.appliedDate,
          referrer: a.contactName || undefined,
          source: a.note || undefined,
        });
        return { done: `已更新投递信息：${application.title}` };
      }

      case "delete_position": {
        if (!a.targetId) throw new UserFacingError("没指明是哪个候选岗位，改成手动删除吧");
        const position = await db.position.findFirst({ where: { id: a.targetId, userId: user.id } });
        if (!position) throw new UserFacingError("找不到这个候选岗位");
        await deletePosition(position.id);
        return { done: `已删除候选岗位：${position.title}` };
      }

      case "withdraw_application": {
        if (!a.targetId) throw new UserFacingError("没指明是哪条投递，改成手动删除吧");
        const application = await db.application.findFirst({
          where: { id: a.targetId, userId: user.id },
        });
        if (!application) throw new UserFacingError("找不到这条投递记录");
        await deleteApplication(application.id);
        return { done: `已删除投递记录：${application.title}` };
      }

      case "complete_task": {
        if (!a.targetId) throw new UserFacingError("没指明是哪条待办，改成手动完成吧");
        const task = await db.personalTask.findFirst({ where: { id: a.targetId, userId: user.id } });
        if (!task) throw new UserFacingError("找不到这条待办");
        await toggleTaskDone(task.id, true);
        return { done: `已完成待办：${task.title}` };
      }

      case "set_schedule": {
        if (!a.targetId) throw new UserFacingError("没指明是哪条投递，到投递详情里添加时间吧");
        const application = await db.application.findFirst({ where: { id: a.targetId, userId: user.id }, select: { id: true, currentStage: true, company: { select: { name: true } } } });
        if (!application) throw new UserFacingError("找不到这条投递记录");
        const when = scheduleTime(a.date, a.dateEnd);
        const stage = applicationStageValues.find((value) => value === a.stage) ?? application.currentStage;
        const result = await addStageSchedule(application.id, stage, { ...when, meetingInfo: a.note?.trim() || null });
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已记下 ${application.company.name} ${STAGE_LABELS[stage]}：${when.label}` };
      }

      case "reschedule": {
        const row = await stepRow(user.id, a.targetId);
        const when = scheduleTime(a.date, a.dateEnd);
        const result = await setStageSchedule(row.id, { ...when, meetingInfo: a.note?.trim() || row.meetingInfo, remindMinutes: row.remindMinutes });
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已改到 ${when.label}：${row.application.company.name} ${STAGE_LABELS[row.stage]}` };
      }

      case "complete_step": {
        const row = await stepRow(user.id, a.targetId);
        const result = await setStepCompleted(row.id, true);
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已标记完成：${row.application.company.name} ${STAGE_LABELS[row.stage]}，开始等结果` };
      }

      case "save_note": {
        const row = await stepRow(user.id, a.targetId);
        const text = a.note?.trim();
        if (!text) throw new UserFacingError("没有要记的内容");
        // Added below what is already there, never in its place.
        const result = await saveStepNote(row.id, row.note?.trim() ? `${row.note.trim()}\n\n${text}` : text);
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已记到 ${row.application.company.name} ${STAGE_LABELS[row.stage]} 的复盘里` };
      }

      case "mark_followed_up": {
        const row = await stepRow(user.id, a.targetId);
        const result = await markFollowedUp(row.id);
        if (!result.ok) throw new UserFacingError(result.message);
        return { done: `已记下跟进过：${row.application.company.name}` };
      }

      case "mark_contacted": {
        if (!a.targetId) throw new UserFacingError("没指明是哪个联系人，改成手动操作吧");
        const contact = await db.contact.findFirst({ where: { id: a.targetId, userId: user.id } });
        if (!contact) throw new UserFacingError("找不到这个联系人");
        await markContacted(contact.id);
        return { done: `已记录联系：${contact.name}` };
      }
    }
  });
}
