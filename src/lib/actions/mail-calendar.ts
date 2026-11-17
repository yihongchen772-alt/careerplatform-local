"use server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError } from "@/lib/action-result";
import { mailEventDraftSchema, confirmedWallTime, type MailEventDraft } from "@/lib/mail-calendar";
import { isTerminalStage, targetStageFor, SCHEDULE_STAGES } from "@/lib/interview-schedule";
import { learnMailCompany, learnMailCompanyFromTask } from "@/lib/mail-schedule";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { RECRUIT_EVENT } from "@/lib/mail-time-extract";
import { rowForSchedule } from "@/lib/schedule-target";
import { syncApplicationEvents } from "@/lib/stage-schedule";
import { z } from "zod";
import { revalidatePath } from "next/cache";
/**
 * `link`: what the applicant chose in the dialog, when the mail's own match is
 * wrong or missing. `applicationId` a 投递 to hang the time on (null = keep it
 * a calendar item of its own); `stage` the step it is for. Left out, the
 * mail's match and the round its text names are used, as before.
 */
export type MailLink = { applicationId?: string | null; stage?: string | null };
const mailLinkSchema = z.object({ applicationId: z.string().max(100).nullable().optional(), stage: z.string().max(40).nullable().optional() }).optional();

/** The 投递 a mail's time can go on (open ones), and the one the mail matched. */
export async function mailLinkChoices(taskId: string) {
  return toActionResult(async () => {
    const user = await requireUser();
    const task = await db.personalTask.findFirst({ where: { id: taskId, userId: user.id }, select: { applicationId: true } });
    if (!task) throw new UserFacingError("这条邮件待办已经不在了，请刷新");
    const applications = await db.application.findMany({ where: { userId: user.id }, select: { id: true, title: true, currentStage: true, company: { select: { name: true } } }, orderBy: { appliedDate: "desc" }, take: 300 });
    const open = applications.filter((app) => !isTerminalStage(app.currentStage));
    return {
      applicationId: open.some((app) => app.id === task.applicationId) ? task.applicationId : null,
      applications: open.map((app) => ({ id: app.id, label: `${app.company.name} · ${app.title}`, stage: STAGE_LABELS[app.currentStage] })),
      stages: SCHEDULE_STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] })),
    };
  });
}

export async function confirmMailCalendar(taskId: string, draft: MailEventDraft, offsetMinutes: number, link?: MailLink) {
  return toActionResult(async () => {
    const user = await requireUser(); const data = mailEventDraftSchema.parse(draft); z.number().int().min(0).max(525600).parse(offsetMinutes);
    const choice = mailLinkSchema.parse(link);
    const chosenStage = SCHEDULE_STAGES.find((stage) => stage === choice?.stage) ?? null;
    if (!data.title.trim()) throw new UserFacingError("事项标题必填");
    if (data.meetingUrl && !/^https?:\/\//i.test(data.meetingUrl)) throw new UserFacingError("会议链接应为网页地址");
    let startsAt: Date, endsAt: Date | null;
    try { startsAt = confirmedWallTime(data.localStart, data.timeZone); endsAt = data.localEnd ? confirmedWallTime(data.localEnd, data.timeZone) : null; } catch (e) { throw new UserFacingError(e instanceof Error ? e.message : "请核对日期和时区"); }
    if (endsAt && endsAt < startsAt) throw new UserFacingError("结束时间不能早于开始时间");
    const meetingInfo = [data.location.trim(), data.meetingUrl.trim(), data.accessCode?.trim() ? `口令：${data.accessCode.trim()}` : ""].filter(Boolean).join(" ").slice(0, 2000) || null;
    const result = await db.$transaction(async (tx) => {
      const task = await tx.personalTask.findFirst({
        where: { id: taskId, userId: user.id },
        include: { application: { select: { id: true, userId: true, currentStage: true, currentStageDate: true, stageHistory: { select: { id: true, stage: true, enteredAt: true, meetingInfo: true } } } } },
      });
      if (!task) throw new UserFacingError("这条邮件待办已经不在了，请刷新");
      if (task.mailEventId) { const saved = await tx.calendarEvent.findFirst({ where: { id: task.mailEventId, userId: user.id } }); if (saved) return { id: saved.id, existing: true, applicationId: task.applicationId }; }
      // A mail about one of the 投递 puts the time on that 投递's current step,
      // so it shows there, in 接下来 and in 日历 — one place to change it.
      // The 投递 picked in the dialog wins over the mail's own match.
      const picked = typeof choice?.applicationId === "string" ? await tx.application.findFirst({ where: { id: choice.applicationId, userId: user.id }, select: { id: true, userId: true, companyId: true, currentStage: true } }) : null;
      if (typeof choice?.applicationId === "string" && !picked) throw new UserFacingError("选的这条投递已经不在了，请刷新");
      if (picked && isTerminalStage(picked.currentStage)) throw new UserFacingError("这条投递已经结束，不能再往上加时间");
      const matched = task.application && task.application.userId === user.id && !isTerminalStage(task.application.currentStage) && !RECRUIT_EVENT.test(`${task.title} ${data.title}`) ? task.application : null;
      const app = picked ?? (choice?.applicationId === null ? null : matched);
      // On the round the invitation is for (moving the 投递 forward to it); a
      // step chosen by hand is taken as said, and a 投递 chosen by hand always
      // gets the time (on its current step when the text names no round ahead).
      const target = app ? chosenStage ?? targetStageFor(app.currentStage, `${data.title} ${task.title} ${data.evidence}`) : null;
      const placed = !app ? null
        : (target ? await rowForSchedule(tx, app.id, target, chosenStage ? { kind: "manual" } : { kind: "forward" }) : null)
          ?? (picked ? await rowForSchedule(tx, app.id, app.currentStage, { kind: "manual" }) : null);
      const relinked = picked && picked.id !== task.applicationId;
      const row = placed ? await tx.stageHistory.findUnique({ where: { id: placed.rowId }, select: { id: true, meetingInfo: true } }) : null;
      if (app && row) {
        await tx.stageHistory.update({ where: { id: row.id }, data: { nextDeadline: startsAt, nextDeadlineEnd: endsAt && endsAt > startsAt ? endsAt : null, nextHasTime: true, meetingInfo: meetingInfo ?? row.meetingInfo, remindMinutes: offsetMinutes, scheduleSource: null } });
        await syncApplicationEvents(tx, app.id);
        const copy = await tx.calendarEvent.findUniqueOrThrow({ where: { stageHistoryId: row.id }, select: { id: true } });
        await tx.personalTask.update({ where: { id: task.id }, data: { mailEventId: copy.id, mailEventDraft: data, done: true, ...(relinked ? { applicationId: app.id } : {}) } });
        // 「这封是这家的」: the name the mail signs with is remembered for next time.
        if (relinked && task.sourceMailKey) await learnMailCompany(tx, user.id, copy.id, picked.companyId);
        return { id: copy.id, existing: false, applicationId: app.id };
      }
      const event = await tx.calendarEvent.create({ data: { userId: user.id, title: data.title, description: [data.location && `地点：${data.location}`, data.meetingUrl && `会议：${data.meetingUrl}`, data.evidence, task.note].filter(Boolean).join("\n"), startsAt, endsAt, timeZone: data.timeZone, dateKey: data.localStart.slice(0, 10), meetingInfo, source: "email", reminders: { create: { offsetMinutes, scheduledAt: new Date(startsAt.getTime() - offsetMinutes * 60000) } } } });
      await tx.personalTask.update({ where: { id: task.id }, data: { mailEventId: event.id, mailEventDraft: data, done: true } });
      return { id: event.id, existing: false, applicationId: null };
    });
    revalidatePath("/dashboard"); revalidatePath("/calendar"); revalidatePath("/applications");
    if (result.applicationId) revalidatePath(`/applications/${result.applicationId}`);
    return result;
  });
}

const bindTargetSchema = z.object({
  kind: z.enum(["application", "position"]),
  id: z.string().min(1).max(100),
});

/** Lists open applications and candidate-pool positions that a mail task can bind to. */
export async function mailBindChoices(taskId: string) {
  return toActionResult(async () => {
    const user = await requireUser();
    const task = await db.personalTask.findFirst({
      where: { id: taskId, userId: user.id },
      select: { applicationId: true, positionId: true },
    });
    if (!task) throw new UserFacingError("这条邮件待办已经不在了，请刷新");
    const [applications, positions] = await Promise.all([
      db.application.findMany({
        where: { userId: user.id },
        select: { id: true, title: true, currentStage: true, company: { select: { name: true } } },
        orderBy: { appliedDate: "desc" },
        take: 200,
      }),
      db.position.findMany({
        where: { userId: user.id, status: { in: ["EVALUATING", "PLANNED"] }, applications: { none: {} } },
        select: { id: true, title: true, company: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const open = applications.filter((app) => !isTerminalStage(app.currentStage));
    return {
      applicationId: task.applicationId,
      positionId: task.positionId,
      applications: open.map((app) => ({ id: app.id, label: `${app.company.name} · ${app.title}（${STAGE_LABELS[app.currentStage]}）` })),
      positions: positions.map((pos) => ({ id: pos.id, label: `${pos.company.name} · ${pos.title}` })),
    };
  });
}

/**
 * Manually links a recognized email task to an existing application (or promotes a
 * candidate-pool position into a new APPLIED application) and learns the company alias.
 */
export async function bindMailTask(taskId: string, target: z.infer<typeof bindTargetSchema>) {
  return toActionResult(async () => {
    const user = await requireUser();
    const choice = bindTargetSchema.parse(target);
    const result = await db.$transaction(async (tx) => {
      const task = await tx.personalTask.findFirst({
        where: { id: taskId, userId: user.id },
        select: { id: true, createdAt: true },
      });
      if (!task) throw new UserFacingError("这条邮件待办已经不在了，请刷新");
      if (choice.kind === "application") {
        const app = await tx.application.findFirst({
          where: { id: choice.id, userId: user.id },
          select: { id: true, companyId: true, currentStage: true, title: true, company: { select: { name: true } } },
        });
        if (!app) throw new UserFacingError("选中的投递已经不在了，请刷新");
        if (isTerminalStage(app.currentStage)) throw new UserFacingError("这条投递已结束，请选择进行中的投递");
        await tx.personalTask.update({ where: { id: task.id }, data: { applicationId: app.id } });
        await learnMailCompanyFromTask(tx, user.id, task.id, app.companyId);
        return { applicationId: app.id, label: `${app.company.name} · ${app.title}`, promoted: false };
      }
      const pos = await tx.position.findFirst({
        where: { id: choice.id, userId: user.id },
        select: { id: true, companyId: true, title: true, company: { select: { name: true } } },
      });
      if (!pos) throw new UserFacingError("该候选岗位已经不在了，请刷新");
      const portals = await tx.applicationPortal.findMany({ where: { companyId: pos.companyId }, select: { id: true }, take: 2 });
      const created = await tx.application.create({
        data: {
          userId: user.id,
          companyId: pos.companyId,
          positionId: pos.id,
          portalId: portals.length === 1 ? portals[0].id : null,
          title: pos.title,
          appliedDate: task.createdAt,
          source: "候选池邮件匹配",
          currentStage: "APPLIED",
          currentStageDate: task.createdAt,
          stageHistory: { create: { stage: "APPLIED", enteredAt: task.createdAt, note: "收到相关求职邮件，由候选池转为投递" } },
        },
        select: { id: true },
      });
      await tx.position.update({ where: { id: pos.id }, data: { status: "APPLIED" } });
      await tx.personalTask.update({ where: { id: task.id }, data: { applicationId: created.id, positionId: pos.id } });
      await learnMailCompanyFromTask(tx, user.id, task.id, pos.companyId);
      return { applicationId: created.id, label: `${pos.company.name} · ${pos.title}`, promoted: true };
    });
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
    revalidatePath("/applications");
    revalidatePath("/pool");
    revalidatePath(`/applications/${result.applicationId}`);
    return result;
  });
}
