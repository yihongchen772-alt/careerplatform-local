import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { DeadlineCalendar, type CalendarEvent } from "@/components/calendar/deadline-calendar";

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

  const events: CalendarEvent[] = [
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
      dateEnd: h.nextDeadlineEnd?.toISOString() ?? null,
      label: `${h.application.company.name} · ${h.application.title} 下一步`,
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
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">日历视图</h1>
        <p className="text-sm text-muted-foreground">
          候选岗位投递截止日期 + 投递记录里填写的下一步截止日期 + 你自己写的日程 + 联系人跟进提醒，一次看清楚有没有撞期
        </p>
      </div>
      <DeadlineCalendar
        events={events}
        positions={positionOptions}
        applications={applicationOptions}
      />
    </div>
  );
}
