import { db } from "@/lib/db";
import {
  applicationScheduleItems,
  compareItems,
  currentStageRow,
  extractMeetingUrl,
  isUpcoming,
  kindFromText,
  type ScheduleItem,
} from "@/lib/interview-schedule";
import { mailTime } from "@/lib/mail-time";
import type { ApplicationStage } from "@prisma/client";

/**
 * Gathers 接下来 for 投递记录 and a 投递's own page: steps with a time or a
 * deadline, calendar items made from invitations, and times recognised in
 * mail that are not on the calendar yet.
 */

const TERMINAL: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"];
const DAY = 86_400_000;

export const scheduleRowSelect = {
  id: true,
  stage: true,
  stageLabel: true,
  enteredAt: true,
  nextDeadline: true,
  nextDeadlineEnd: true,
  nextHasTime: true,
  meetingInfo: true,
  remindMinutes: true,
  interviewFormat: true,
  scheduleSource: true,
  completedAt: true,
  followedUpAt: true,
} as const;

type EventRow = { id: string; title: string; description: string; startsAt: Date; endsAt: Date | null; allDay: boolean; dateKey: string; meetingInfo: string | null; source: string | null };

/** A calendar item as a 接下来 entry. All-day items use the date-only shape. */
export function eventItem(event: EventRow): ScheduleItem {
  const meetingInfo = event.meetingInfo?.trim()
    || (extractMeetingUrl(event.description) ? event.description.split("\n").find((line) => extractMeetingUrl(line))?.replace(/^会议[:：]\s*/, "").trim() ?? null : null);
  return {
    key: `event:${event.id}`,
    source: "event",
    sourceId: event.id,
    kind: kindFromText(`${event.title}\n${event.description}`),
    startsAt: event.allDay ? `${event.dateKey}T00:00:00.000Z` : event.startsAt.toISOString(),
    endsAt: event.allDay ? null : event.endsAt?.toISOString() ?? null,
    hasTime: !event.allDay,
    title: event.title,
    applicationId: null,
    companyName: null,
    jobTitle: null,
    meetingInfo: meetingInfo || null,
  };
}

type DraftTask = {
  id: string;
  title: string;
  note: string | null;
  mailEventDraft: unknown;
  applicationId: string | null;
  application: { id: string; title: string; currentStage: ApplicationStage; currentStageDate: Date; company: { name: string }; stageHistory: { id: string; stage: ApplicationStage; enteredAt: Date; nextDeadline: Date | null; nextHasTime: boolean; scheduleSource: string | null }[] } | null;
};

/** A recognised time that is not written anywhere yet. */
export function draftItem(task: DraftTask): ScheduleItem | null {
  const time = mailTime(task.mailEventDraft);
  if (!time) return null;
  const app = task.application;
  let conflictsWith: string | null = null;
  if (app && !TERMINAL.includes(app.currentStage)) {
    const row = currentStageRow(app, app.stageHistory);
    if (row?.nextHasTime && row.nextDeadline && row.nextDeadline.getTime() !== time.startsAt.getTime()) conflictsWith = row.nextDeadline.toISOString();
  }
  return {
    key: `mail:${task.id}`,
    source: "mail",
    sourceId: task.id,
    kind: kindFromText(`${time.title}\n${task.title}`),
    startsAt: time.startsAt.toISOString(),
    endsAt: time.endsAt?.toISOString() ?? null,
    hasTime: true,
    title: time.title || task.title,
    applicationId: app?.id ?? null,
    companyName: app?.company.name ?? null,
    jobTitle: app?.title ?? null,
    meetingInfo: time.meetingInfo,
    evidence: time.evidence || null,
    conflictsWith,
  };
}

const draftTaskSelect = {
  id: true,
  title: true,
  note: true,
  mailEventDraft: true,
  applicationId: true,
  application: {
    select: {
      id: true,
      title: true,
      currentStage: true,
      currentStageDate: true,
      company: { select: { name: true } },
      stageHistory: { select: { id: true, stage: true, enteredAt: true, nextDeadline: true, nextHasTime: true, scheduleSource: true } },
    },
  },
} as const;

/** Drafts already covered by a step or another copy of the same mail go. */
function dedupe(items: ScheduleItem[]): ScheduleItem[] {
  const seen = new Set<string>();
  const out: ScheduleItem[] = [];
  for (const item of [...items].sort((a, b) => (a.source === "mail" ? 1 : 0) - (b.source === "mail" ? 1 : 0))) {
    const slot = `${item.applicationId ?? item.title}|${item.startsAt}`;
    if (item.source === "mail" && seen.has(slot)) continue;
    seen.add(slot);
    out.push(item);
  }
  return out.sort(compareItems);
}

export async function loadUpcomingSchedule(userId: string, now = new Date(), days = 7): Promise<ScheduleItem[]> {
  const nowMs = now.getTime();
  const horizon = new Date(nowMs + days * DAY);
  const [apps, linkedEventIds, drafts] = await Promise.all([
    db.application.findMany({
      where: { userId, currentStage: { notIn: TERMINAL }, stageHistory: { some: { nextDeadline: { not: null } } } },
      select: { id: true, title: true, currentStage: true, currentStageDate: true, company: { select: { name: true } }, stageHistory: { select: scheduleRowSelect } },
    }),
    db.personalTask.findMany({ where: { userId, mailEventId: { not: null } }, select: { mailEventId: true } }),
    db.personalTask.findMany({ where: { userId, done: false, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null }, select: draftTaskSelect }),
  ]);
  const ids = linkedEventIds.map((task) => task.mailEventId!).filter(Boolean);
  // Only job-search items: the ones made from mail. The applicant's own
  // calendar (gym, classes) stays in 日历 and 总览.
  const events = await db.calendarEvent.findMany({
    where: { userId, stageHistoryId: null, startsAt: { lte: horizon }, OR: [{ source: "email" }, { id: { in: ids } }] },
    select: { id: true, title: true, description: true, startsAt: true, endsAt: true, allDay: true, dateKey: true, meetingInfo: true, source: true },
  });
  const items: ScheduleItem[] = [];
  for (const app of apps) {
    items.push(...applicationScheduleItems({ id: app.id, title: app.title, companyName: app.company.name, currentStage: app.currentStage, currentStageDate: app.currentStageDate }, app.stageHistory, nowMs));
  }
  for (const event of events) items.push(eventItem(event));
  for (const task of drafts) {
    const item = draftItem(task);
    if (item) items.push(item);
  }
  return dedupe(items.filter((item) => isUpcoming(item, nowMs, days)));
}

/** One 投递: its steps' times (past current one included) and its unwritten mail times. */
export async function loadApplicationSchedule(userId: string, applicationId: string, now = new Date()) {
  const nowMs = now.getTime();
  const [app, drafts, tasks] = await Promise.all([
    db.application.findFirst({
      where: { id: applicationId, userId },
      select: { id: true, title: true, currentStage: true, currentStageDate: true, company: { select: { name: true } }, stageHistory: { select: scheduleRowSelect } },
    }),
    db.personalTask.findMany({ where: { userId, applicationId, done: false, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null }, select: draftTaskSelect }),
    db.personalTask.findMany({
      where: { userId, applicationId },
      select: { id: true, title: true, note: true, done: true, dueDate: true, createdAt: true, mailEventDraft: true, mailEventId: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  if (!app) return { items: [] as ScheduleItem[], tasks: [] };
  const items = applicationScheduleItems({ id: app.id, title: app.title, companyName: app.company.name, currentStage: app.currentStage, currentStageDate: app.currentStageDate }, app.stageHistory, nowMs);
  for (const task of drafts) {
    const item = draftItem(task);
    if (item && isUpcoming(item, nowMs, 3650)) items.push(item);
  }
  return {
    items: dedupe(items),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      // The first line is the AI's one-sentence summary of the mail.
      summary: task.note?.split("\n")[0]?.trim() || null,
      done: task.done,
      createdAt: task.createdAt.toISOString(),
      fromMail: !!task.mailEventDraft || /邮件主题：/.test(task.note ?? ""),
    })),
  };
}
