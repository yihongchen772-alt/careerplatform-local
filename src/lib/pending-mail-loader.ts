import { db } from "@/lib/db";
import { pendingMailRows, type PendingRow } from "@/lib/pending-mail";
import type { Slot } from "@/lib/interview-schedule";

const WINDOW_DAYS = 45;  // keep in step with isCalendarMailTask

/**
 * The mail-made 待办 still waiting to get onto the calendar. One reader for
 * 日历 (which lists them) and 总览 (which only points at them and keeps them
 * out of 我的待办), so the two never disagree about what is pending.
 */
export async function loadPendingMail(userId: string, now: number): Promise<PendingRow[]> {
  const [tasks, scheduled, events] = await Promise.all([
    db.personalTask.findMany({
      where: { userId, done: false, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null, sourceMailKey: { not: null }, createdAt: { gte: new Date(now - WINDOW_DAYS * 86_400_000) } },
      select: {
        id: true,
        title: true,
        note: true,
        mailEventDraft: true,
        applicationId: true,
        positionId: true,
        position: { select: { title: true, company: { select: { name: true } } } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.stageHistory.findMany({
      where: { nextDeadline: { gte: new Date(now - 86_400_000) }, application: { userId } },
      select: { applicationId: true },
    }),
    db.calendarEvent.findMany({
      where: { userId, allDay: false, startsAt: { gte: new Date(now - 12 * 3_600_000) } },
      select: { id: true, title: true, startsAt: true, endsAt: true },
      take: 200,
    }),
  ]);
  const slots: Slot[] = events.map((e) => ({
    key: e.id,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    label: e.title,
  }));
  return pendingMailRows(
    tasks.map((t) => ({
      ...t,
      positionLabel: t.position ? `${t.position.company.name} · ${t.position.title}` : null,
    })),
    now,
    new Set(scheduled.map((row) => row.applicationId)),
    slots,
  );
}
