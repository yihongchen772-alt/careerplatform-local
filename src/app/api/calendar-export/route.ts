import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { buildCalendarIcs, type ExportCalendarEvent } from "@/lib/calendar-export";
export async function GET(request: Request) {
  const user = await requireUser(); const eventId = new URL(request.url).searchParams.get("eventId");
  const personal = await db.calendarEvent.findMany({ where: { userId: user.id, ...(eventId ? { id: eventId } : {}) }, include: { reminders: true } });
  if (eventId && !personal.length) return Response.json({ error: "日程不存在" }, { status: 404 });
  const events: ExportCalendarEvent[] = personal.map((e) => ({ ...e, offsetMinutes: e.reminders[0]?.offsetMinutes }));
  if (!eventId) {
    const [positions, stages, tasks, contacts] = await Promise.all([
      db.position.findMany({ where: { userId: user.id, deadline: { not: null }, status: { not: "APPLIED" } }, include: { company: true } }),
      db.stageHistory.findMany({ where: { application: { userId: user.id }, nextDeadline: { not: null } }, include: { application: { include: { company: true } } } }),
      db.personalTask.findMany({ where: { userId: user.id, done: false, dueDate: { not: null } } }),
      db.contact.findMany({ where: { userId: user.id, nextFollowUpAt: { not: null } } }),
    ]);
    events.push(...positions.map((p) => ({ id: `position-${p.id}`, title: `${p.company.name} · ${p.title} 投递截止`, startsAt: p.deadline!, description: p.jdUrl })), ...stages.map((s) => ({ id: `stage-${s.id}`, title: `${s.application.company.name} · ${s.application.title} 下一步`, startsAt: s.nextDeadline!, endsAt: s.nextDeadlineEnd, description: s.note })), ...tasks.map((t) => ({ id: `task-${t.id}`, title: t.title, startsAt: t.dueDate!, endsAt: t.dueDateEnd, description: t.note })), ...contacts.map((c) => ({ id: `contact-${c.id}`, title: `跟进 ${c.name}`, startsAt: c.nextFollowUpAt! })));
  }
  return new Response(buildCalendarIcs(events), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="jobcompass-calendar.ics"', "Cache-Control": "no-store" } });
}
