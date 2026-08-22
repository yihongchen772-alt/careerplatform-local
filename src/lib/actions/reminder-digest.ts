"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { buildTodos, type Todo } from "@/lib/todos";
import { getUserMailConfig, sendMail } from "@/lib/mailer";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

async function collectTodos(userId: string): Promise<Todo[]> {
  const [applications, positions, stageHistories, personalTasks] = await Promise.all([
    db.application.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { appliedDate: "desc" },
    }),
    db.position.findMany({
      where: { userId, status: { not: "APPLIED" } },
      include: { company: true },
    }),
    db.stageHistory.findMany({
      where: { application: { userId }, nextDeadline: { not: null } },
      include: { application: { include: { company: true } } },
    }),
    db.personalTask.findMany({ where: { userId } }),
  ]);

  return buildTodos(applications, positions, stageHistories, personalTasks);
}

const URGENCY_LABEL: Record<Todo["urgency"], string> = {
  overdue: "已逾期",
  urgent: "很急",
  soon: "临近",
};

function renderDigestHtml(todos: Todo[]): string {
  const rows = todos
    .map(
      (t) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">
          <strong>${escapeHtml(t.label)}</strong><br/>
          <span style="color:#666;font-size:13px;">${escapeHtml(t.sublabel)}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${t.urgency === "overdue" || t.urgency === "urgent" ? "#dc2626" : "#666"};">
          ${URGENCY_LABEL[t.urgency]}
        </td>
      </tr>`
    )
    .join("");

  return `<div style="font-family:sans-serif;max-width:520px;">
    <h2 style="margin-bottom:4px;">秋招追踪 · 待办提醒</h2>
    <p style="color:#666;font-size:14px;">共 ${todos.length} 件事需要关注</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Manual trigger from the dashboard button — always sends, even a "you're
 * all caught up" email, since the user explicitly asked for one right now.
 */
export async function sendReminderDigestNow(): Promise<ActionResult<{ count: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const config = await getUserMailConfig(user.id);
    if (!config) {
      throw new UserFacingError("先在账号设置里配置好邮箱才能发提醒");
    }

    const todos = await collectTodos(user.id);
    const html =
      todos.length > 0
        ? renderDigestHtml(todos)
        : `<div style="font-family:sans-serif;"><h2>秋招追踪</h2><p>暂时没有要处理的事，保持住 👍</p></div>`;

    await sendMail(config, {
      to: config.user,
      subject: todos.length > 0 ? `秋招追踪：${todos.length} 件事需要关注` : "秋招追踪：一切正常",
      html,
    });

    return { count: todos.length };
  });
}

/**
 * Called once per app launch (see the API route Electron's main process
 * hits after the server is up). Silent no-op if email isn't configured or
 * there's nothing urgent — this must never surface an error to a plain app
 * boot, so it swallows failures itself rather than using the throw-based
 * ActionResult pattern the user-triggered actions use.
 */
export async function checkAndSendOnLaunch(userId: string): Promise<void> {
  try {
    const config = await getUserMailConfig(userId);
    if (!config) return;

    const todos = await collectTodos(userId);
    const urgent = todos.filter((t) => t.urgency === "overdue" || t.urgency === "urgent");
    if (urgent.length === 0) return;

    await sendMail(config, {
      to: config.user,
      subject: `秋招追踪：${urgent.length} 件事需要关注`,
      html: renderDigestHtml(urgent),
    });
  } catch (err) {
    console.error("[reminder-digest] on-launch check failed", err);
  }
}
