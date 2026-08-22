import type { ApplicationStage } from "@prisma/client";
import {
  daysUntil,
  findStaleApplications,
  findUpcomingPositionDeadlines,
  isTerminalStage,
} from "@/lib/reminders";

export type TodoUrgency = "overdue" | "urgent" | "soon";

export type Todo = {
  id: string;
  label: string;
  sublabel: string;
  urgency: TodoUrgency;
  href: string;
  /** Lower sorts first. */
  order: number;
};

const NEXT_STEP_WINDOW_DAYS = 7;

function urgencyOf(daysLeft: number): TodoUrgency {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 1) return "urgent";
  return "soon";
}

type TodoApplication = {
  id: string;
  title: string;
  currentStage: ApplicationStage;
  currentStageDate: Date;
  company: { name: string };
};

type TodoPosition = {
  id: string;
  title: string;
  deadline: Date | null;
  company: { name: string };
};

type TodoStageHistory = {
  id: string;
  stage: ApplicationStage;
  nextDeadline: Date | null;
  application: {
    id: string;
    title: string;
    currentStage: ApplicationStage;
    company: { name: string };
  };
};

export type TodoPersonalTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  done: boolean;
};

export function buildTodos(
  applications: TodoApplication[],
  positions: TodoPosition[],
  stageHistories: TodoStageHistory[],
  personalTasks: TodoPersonalTask[] = []
): Todo[] {
  const todos: Todo[] = [];

  // User-written plans surface the same way the auto-derived ones do — due
  // today/overdue is urgent, within the window is "soon". Undated tasks
  // (a plain checklist item with no deadline) don't belong in a
  // deadline-ranked list, so they're left out here and shown separately.
  for (const t of personalTasks) {
    if (t.done || !t.dueDate) continue;
    const daysLeft = daysUntil(t.dueDate);
    if (daysLeft > NEXT_STEP_WINDOW_DAYS) continue;
    todos.push({
      id: `task-${t.id}`,
      label: t.title,
      sublabel:
        daysLeft < 0
          ? `已过期 ${-daysLeft} 天`
          : daysLeft === 0
            ? "今天到期"
            : `还有 ${daysLeft} 天`,
      urgency: urgencyOf(daysLeft),
      href: "/dashboard",
      order: daysLeft,
    });
  }

  for (const app of findStaleApplications(applications)) {
    todos.push({
      id: `stale-${app.id}`,
      label: `${app.companyName} · ${app.title}`,
      sublabel: `已 ${app.daysStale} 天没更新，该催一下 HR 了`,
      urgency: "overdue",
      href: `/applications/${app.id}`,
      order: -app.daysStale,
    });
  }

  for (const p of findUpcomingPositionDeadlines(positions)) {
    todos.push({
      id: `deadline-${p.id}`,
      label: `${p.companyName} · ${p.title}`,
      sublabel:
        p.daysLeft === 0 ? "今天截止投递" : `还有 ${p.daysLeft} 天截止投递`,
      urgency: urgencyOf(p.daysLeft),
      href: "/pool",
      order: p.daysLeft,
    });
  }

  for (const h of stageHistories) {
    if (!h.nextDeadline) continue;
    // A finished application's leftover next-step date isn't actionable.
    if (isTerminalStage(h.application.currentStage)) continue;
    const daysLeft = daysUntil(h.nextDeadline);
    if (daysLeft > NEXT_STEP_WINDOW_DAYS) continue;
    todos.push({
      id: `next-${h.id}`,
      label: `${h.application.company.name} · ${h.application.title}`,
      sublabel:
        daysLeft < 0
          ? `下一步已过期 ${-daysLeft} 天`
          : daysLeft === 0
            ? "下一步今天截止"
            : `下一步还有 ${daysLeft} 天`,
      urgency: urgencyOf(daysLeft),
      href: `/applications/${h.application.id}`,
      order: daysLeft,
    });
  }

  const rank: Record<TodoUrgency, number> = { overdue: 0, urgent: 1, soon: 2 };
  return todos.sort(
    (a, b) => rank[a.urgency] - rank[b.urgency] || a.order - b.order
  );
}
