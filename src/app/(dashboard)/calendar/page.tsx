import { DesktopLinks } from "@/components/productivity/desktop-links";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { DeadlineCalendar, type CalendarEvent } from "@/components/calendar/deadline-calendar";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { PageHero } from "@/components/layout/page-hero";
import { buttonVariants } from "@/components/ui/button";
import { CalendarDays } from "lucide-react";
import { AddScheduleDialog, type ScheduleApplication } from "@/components/calendar/add-schedule-dialog";
import { PendingMailPanel } from "@/components/calendar/pending-mail-panel";
import { pendingMailRows } from "@/lib/pending-mail";
import { isTerminalStage } from "@/lib/interview-schedule";
import { currentTimeMs } from "@/lib/dates";

export default async function CalendarPage() {
  const user = await requireUser();

  const [positions, stageHistory, personalTasks, allApplications, contacts] =
    await Promise.all([
      db.position.findMany({
        where: { userId: user.id, status: { not: "APPLIED" }, deadline: { not: null } },
        include: { company: true },
      }),
      db.stageHistory.findMany({
        where: {
          nextDeadline: { not: null },
          application: { userId: user.id },
        },
        include: { application: { include: { company: true } } },
      }),
      db.personalTask.findMany({
        where: { userId: user.id, done: false, dueDate: { not: null } },
        select: { id: true, title: true, dueDate: true, dueDateEnd: true },
      }),
      // For the add dialog's 投递 picker: every application, not just the
      // ones with a time already on the calendar.
      db.application.findMany({
        where: { userId: user.id },
        include: { company: true },
      }),
      db.contact.findMany({
        where: { userId: user.id, nextFollowUpAt: { not: null } },
        select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
      }),
    ]);

  const now = currentTimeMs();
  const pendingTasks = await db.personalTask.findMany({
    where: { userId: user.id, done: false, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null, sourceMailKey: { not: null }, createdAt: { gte: new Date(now - 45 * 86_400_000) } },
    select: { id: true, title: true, note: true, mailEventDraft: true, applicationId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const scheduledApps = new Set(stageHistory.filter((h) => h.nextDeadline && h.nextDeadline.getTime() >= now - 86_400_000).map((h) => h.applicationId));
  const pending = pendingMailRows(pendingTasks, now, scheduledApps);
  const scheduleApps: ScheduleApplication[] = allApplications
    .filter((a) => !isTerminalStage(a.currentStage))
    .map((a) => ({ id: a.id, companyName: a.company.name, aliases: [], title: a.title, currentStage: a.currentStage }));

  // Calendar copies of 投递 steps are already in stageHistory below.
  const personalEvents = await db.calendarEvent.findMany({ where: { userId: user.id, stageHistoryId: null } });
  const clock = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const listed: CalendarEvent[] = [
    ...personalEvents.map((e) => ({ id: `event-${e.id}`, date: e.allDay ? `${e.dateKey}T00:00:00` : e.startsAt.toISOString(), dateEnd: e.allDay ? e.endsAt?.toISOString() ?? null : null, until: e.allDay ? null : e.endsAt?.toISOString() ?? null, label: e.title, timed: !e.allDay, href: `/calendar/events?id=${e.id}` })),
    ...positions.map((p) => ({
      id: `position-${p.id}`,
      date: p.deadline!.toISOString(),
      dateEnd: null,
      label: `${p.company.name} · ${p.title} 投递截止`,
      timed: false,
      href: "/pool",
    })),
    ...stageHistory.map((h) => ({
      id: `stage-${h.id}`,
      date: h.nextDeadline!.toISOString(),
      // A booked slot's end is the same day; only a window spans days.
      dateEnd: h.nextHasTime ? null : h.nextDeadlineEnd?.toISOString() ?? null,
      label: h.nextHasTime
        ? `${clock(h.nextDeadline!)} ${h.application.company.name} · ${h.stageLabel || STAGE_LABELS[h.stage]}（${h.application.title}）`
        : `${h.application.company.name} · ${h.application.title} 下一步`,
      timed: h.nextHasTime,
      until: h.nextHasTime ? h.nextDeadlineEnd?.toISOString() ?? null : null,
      href: `/applications/${h.application.id}`,
    })),
    ...personalTasks.map((t) => ({
      id: `task-${t.id}`,
      date: t.dueDate!.toISOString(),
      dateEnd: t.dueDateEnd?.toISOString() ?? null,
      label: `📌 ${t.title}`,
      timed: false,
      href: "/dashboard",
    })),
    ...contacts.map((c) => ({
      id: `contact-${c.id}`,
      date: c.nextFollowUpAt!.toISOString(),
      dateEnd: null,
      label: `📇 跟进 ${c.name}${c.companyName ? ` · ${c.companyName}` : ""}`,
      timed: false,
      href: "/contacts",
    })),
  ];

  // Two steps of one 投递 sharing a day would list the same line twice.
  const seen = new Set<string>();
  const events = listed.filter((event) => {
    const key = `${event.label}|${event.date}|${event.dateEnd ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHero title="日历视图" icon={CalendarDays} description="候选岗位投递截止日期 + 投递记录里填写的下一步截止日期 + 你自己写的日程 + 联系人跟进提醒，一次看清楚有没有撞期" />
      <div className="flex flex-wrap items-center gap-2">
        <AddScheduleDialog applications={scheduleApps} />
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href="/api/calendar-export">导出 ICS 到系统 / 手机日历</a>
      </div>
      <p className="text-xs text-muted-foreground">加面试、笔试、截止日，统一点「添加面试 / 笔试」；邮件里读到的会自动进日历，读不出时间的在下面等你补。导出的是当前快照，之后改动需要重新导入。</p>
      <PendingMailPanel items={pending} />
      <DesktopLinks />
      <DeadlineCalendar events={events} scheduleApps={scheduleApps} />
    </div>
  );
}
