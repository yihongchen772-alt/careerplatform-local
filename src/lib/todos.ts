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
  nextDeadlineEnd: Date | null;
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
  dueDateEnd: Date | null;
  done: boolean;
};

export type TodoContact = {
  id: string;
  name: string;
  companyName: string | null;
  nextFollowUpAt: Date | null;
};

/**
 * A window (笔试/测评 windows routinely span days, not a single moment) is
 * urgent based on when it *closes*, not when it opens — the whole point of
 * "8/26-8/30 期间任意时间可测" is that today isn't a deadline yet. Sharing
 * this between PersonalTask and StageHistory since both can now carry a
 * window instead of a single point.
 */
export function windowStatus(
  start: Date,
  end: Date | null
): { urgencyDate: Date; note: string } {
  if (!end) {
    const daysLeft = daysUntil(start);
    return {
      urgencyDate: start,
      note:
        daysLeft < 0
          ? `已过期 ${-daysLeft} 天`
          : daysLeft === 0
            ? "今天到期"
            : `还有 ${daysLeft} 天`,
    };
  }
  if (new Date() < start) {
    const daysUntilOpen = daysUntil(start);
    return {
      urgencyDate: start,
      note: daysUntilOpen === 0 ? "窗口今天开放" : `窗口 ${daysUntilOpen} 天后开放`,
    };
  }
  const daysLeft = daysUntil(end);
  return {
    urgencyDate: end,
    note:
      daysLeft < 0
        ? `窗口已过期 ${-daysLeft} 天`
        : daysLeft === 0
          ? "窗口今天关闭"
          : `窗口还剩 ${daysLeft} 天`,
  };
}

export function buildTodos(
  applications: TodoApplication[],
  positions: TodoPosition[],
  stageHistories: TodoStageHistory[],
  personalTasks: TodoPersonalTask[] = [],
  contacts: TodoContact[] = []
): Todo[] {
  const todos: Todo[] = [];

  // User-written plans surface the same way the auto-derived ones do — due
  // today/overdue is urgent, within the window is "soon". Undated tasks
  // (a plain checklist item with no deadline) don't belong in a
  // deadline-ranked list, so they're left out here and shown separately.
  for (const t of personalTasks) {
    if (t.done || !t.dueDate) continue;
    const { urgencyDate, note } = windowStatus(t.dueDate, t.dueDateEnd);
    const daysLeft = daysUntil(urgencyDate);
    if (daysLeft > NEXT_STEP_WINDOW_DAYS) continue;
    todos.push({
      id: `task-${t.id}`,
      label: t.title,
      sublabel: note,
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
    const { urgencyDate, note } = windowStatus(h.nextDeadline, h.nextDeadlineEnd);
    const daysLeft = daysUntil(urgencyDate);
    if (daysLeft > NEXT_STEP_WINDOW_DAYS) continue;
    todos.push({
      id: `next-${h.id}`,
      label: `${h.application.company.name} · ${h.application.title}`,
      sublabel: `下一步${note}`,
      urgency: urgencyOf(daysLeft),
      href: `/applications/${h.application.id}`,
      order: daysLeft,
    });
  }

  for (const c of contacts) {
    if (!c.nextFollowUpAt) continue;
    const daysLeft = daysUntil(c.nextFollowUpAt);
    if (daysLeft > NEXT_STEP_WINDOW_DAYS) continue;
    todos.push({
      id: `contact-${c.id}`,
      label: `联系 ${c.name}${c.companyName ? ` · ${c.companyName}` : ""}`,
      sublabel:
        daysLeft < 0
          ? `该跟进了，已过期 ${-daysLeft} 天`
          : daysLeft === 0
            ? "今天该跟进"
            : `还有 ${daysLeft} 天该跟进`,
      urgency: urgencyOf(daysLeft),
      href: "/contacts",
      order: daysLeft,
    });
  }

  const rank: Record<TodoUrgency, number> = { overdue: 0, urgent: 1, soon: 2 };
  return todos.sort(
    (a, b) => rank[a.urgency] - rank[b.urgency] || a.order - b.order
  );
}
