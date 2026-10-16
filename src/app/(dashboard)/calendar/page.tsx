import { DesktopLinks } from "@/components/productivity/desktop-links";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { DeadlineCalendar, type CalendarEvent } from "@/components/calendar/deadline-calendar";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { PageHero } from "@/components/layout/page-hero";
import { buttonVariants } from "@/components/ui/button";
import { CalendarDays } from "lucide-react";

export default async function CalendarPage() {
  const user = await requireUser();

  const [positions, stageHistory, personalTasks, allPositions, allApplications, contacts] =
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
      // For the "关联到" picker on click-to-add — every position/application,
      // not just the ones with a deadline already surfaced on the calendar.
      db.position.findMany({
        where: { userId: user.id },
        include: { company: true },
      }),
      db.application.findMany({
        where: { userId: user.id },
        include: { company: true },
      }),
      db.contact.findMany({
        where: { userId: user.id, nextFollowUpAt: { not: null } },
        select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
      }),
    ]);

  const positionOptions = allPositions.map((p) => ({
    id: p.id,
    label: `候选：${p.company.name} · ${p.title}`,
  }));
  const applicationOptions = allApplications.map((a) => ({
    id: a.id,
    label: `投递：${a.company.name} · ${a.title}`,
  }));

  // Calendar copies of 投递 steps are already in stageHistory below.
  const personalEvents = await db.calendarEvent.findMany({ where: { userId: user.id, stageHistoryId: null } });
  const clock = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const events: CalendarEvent[] = [
    ...personalEvents.map((e) => ({ id: `event-${e.id}`, date: e.allDay ? `${e.dateKey}T00:00:00` : e.startsAt.toISOString(), dateEnd: e.endsAt?.toISOString() ?? null, label: e.title, href: `/calendar/events?id=${e.id}` })),
    ...positions.map((p) => ({
      id: `position-${p.id}`,
      date: p.deadline!.toISOString(),
      dateEnd: null,
      label: `${p.company.name} · ${p.title} 投递截止`,
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
      href: `/applications/${h.application.id}`,
    })),
    ...personalTasks.map((t) => ({
      id: `task-${t.id}`,
      date: t.dueDate!.toISOString(),
      dateEnd: t.dueDateEnd?.toISOString() ?? null,
      label: `📌 ${t.title}`,
      href: "/dashboard",
    })),
    ...contacts.map((c) => ({
      id: `contact-${c.id}`,
      date: c.nextFollowUpAt!.toISOString(),
      dateEnd: null,
      label: `📇 跟进 ${c.name}${c.companyName ? ` · ${c.companyName}` : ""}`,
      href: "/contacts",
    })),
  ];

  return (
    <div className="space-y-6">
      <PageHero title="日历视图" icon={CalendarDays} description="候选岗位投递截止日期 + 投递记录里填写的下一步截止日期 + 你自己写的日程 + 联系人跟进提醒，一次看清楚有没有撞期" />
      <a className={buttonVariants({ variant: "outline", size: "sm" })} href="/api/calendar-export">导出 ICS 到系统 / 手机日历</a>
      <p className="text-xs text-muted-foreground">导出当前日程快照；之后修改安排需要重新导入。系统日历是否提醒取决于你的日历设置。</p>
      <DesktopLinks />
      <DeadlineCalendar
        events={events}
        positions={positionOptions}
        applications={applicationOptions}
      />
    </div>
  );
}
