import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { DeadlineCalendar, type CalendarEvent } from "@/components/calendar/deadline-calendar";

export default async function CalendarPage() {
  const user = await requireUser();

  const [positions, stageHistory, personalTasks, allPositions, allApplications] =
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
      date: p.deadline!.toISOString(),
      label: `${p.company.name} · ${p.title} 投递截止`,
      href: "/pool",
    })),
    ...stageHistory.map((h) => ({
      date: h.nextDeadline!.toISOString(),
      label: `${h.application.company.name} · ${h.application.title} 下一步`,
      href: `/applications/${h.application.id}`,
    })),
    ...personalTasks.map((t) => ({
      date: t.dueDate!.toISOString(),
      label: `📌 ${t.title}`,
      href: "/dashboard",
    })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">日历视图</h1>
        <p className="text-sm text-muted-foreground">
          候选岗位投递截止日期 + 投递记录里填写的下一步截止日期 + 你自己写的日程，一次看清楚有没有撞期
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
