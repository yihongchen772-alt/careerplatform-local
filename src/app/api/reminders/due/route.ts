import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { buildTodos } from "@/lib/todos";

/**
 * Read-only feed of what's urgent right now, for Electron's background timer
 * to turn into native notifications. Separate from /api/check-reminders
 * (which sends an email digest and mutates lastEmailCheckAt) precisely
 * because this one runs on a loop and must stay side-effect free — the main
 * process decides what it has already shown.
 */
export async function GET() {
  const user = await requireUser();

  const [applications, positions, stageHistories, personalTasks, contacts] = await Promise.all([
    db.application.findMany({ where: { userId: user.id }, include: { company: true } }),
    db.position.findMany({
      where: { userId: user.id, status: { not: "APPLIED" } },
      include: { company: true },
    }),
    db.stageHistory.findMany({
      where: { application: { userId: user.id }, nextDeadline: { not: null } },
      include: { application: { include: { company: true } } },
    }),
    db.personalTask.findMany({ where: { userId: user.id } }),
    db.contact.findMany({
      where: { userId: user.id, nextFollowUpAt: { not: null } },
      select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
    }),
  ]);

  const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts);

  // Only things that are actually time-critical are worth interrupting for.
  const urgent = todos
    .filter((t) => t.urgency === "overdue" || t.urgency === "urgent")
    .map((t) => ({ id: t.id, label: t.label, sublabel: t.sublabel, urgency: t.urgency }));

  return NextResponse.json({ urgent });
}
