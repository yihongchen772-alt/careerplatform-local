import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { DeadlineCalendar, type CalendarEvent } from "@/components/calendar/deadline-calendar";

export default async function CalendarPage() {
  const user = await requireUser();

  const [positions, stageHistory, personalTasks] = await Promise.all([
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
  ]);

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
        <h1 className="text-2xl font-semibold">日历视图</h1>
        <p className="text-sm text-muted-foreground">
          候选岗位投递截止日期 + 投递记录里填写的下一步截止日期 + 你自己写的日程，一次看清楚有没有撞期
        </p>
      </div>
      <DeadlineCalendar events={events} />
    </div>
  );
}
