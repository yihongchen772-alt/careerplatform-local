"use server";

import { dueEmailReminderDay } from "@/lib/email-reminder-schedule";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { buildTodos, type Todo } from "@/lib/todos";
import { getUserMailConfig, sendMail } from "@/lib/mailer";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

async function collectTodos(userId: string): Promise<Todo[]> {
  const [applications, positions, stageHistories, personalTasks, contacts, calendarEvents] = await Promise.all([
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
    db.contact.findMany({
      where: { userId, nextFollowUpAt: { not: null } },
      select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
    }),
    db.calendarEvent.findMany({ where: { userId } }),
  ]);

  return buildTodos(applications, positions, stageHistories, personalTasks, contacts, calendarEvents);
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
    <h2 style="margin-bottom:4px;">求职罗盘 · 待办提醒</h2>
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
        : `<div style="font-family:sans-serif;"><h2>求职罗盘</h2><p>暂时没有要处理的事，保持住 👍</p></div>`;

    await sendMail(config, {
      to: config.user,
      subject: todos.length > 0 ? `求职罗盘：${todos.length} 件事需要关注` : "求职罗盘：一切正常",
      html,
    });

    return { count: todos.length };
  });
}

/** Daily check shared by launch, inbox scans and the desktop minute timer. */
export async function checkAndSendOnLaunch(userId: string): Promise<void> {
  const now = new Date();
  let claimed = false;
  const claimUntil = new Date(now.getTime() + 5 * 60000);
  const owned = { id: userId, emailReminderClaimUntil: claimUntil };
  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user?.smtpUser) return;
    const day = dueEmailReminderDay({ enabled: user.emailReminderEnabled, time: user.emailReminderTime, timeZone: user.emailReminderTimeZone }, now);
    if (!day || user.emailReminderLastDay === day) return;
    const config = await getUserMailConfig(userId);
    if (!config) return;
    const claim = await db.user.updateMany({ where: {
      id: userId, emailReminderEnabled: true,
      emailReminderTime: user.emailReminderTime, emailReminderTimeZone: user.emailReminderTimeZone,
      AND: [
        { OR: [{ emailReminderLastDay: null }, { emailReminderLastDay: { not: day } }] },
        { OR: [{ emailReminderClaimUntil: null }, { emailReminderClaimUntil: { lte: now } }] },
      ],
    }, data: { emailReminderClaimUntil: claimUntil } });
    if (!claim.count) return;
    claimed = true;
    const urgent = (await collectTodos(userId)).filter((t) => t.urgency === "overdue" || t.urgency === "urgent");
    const latest = await db.user.findUnique({ where: { id: userId } });
    const scheduleUnchanged = latest && latest.emailReminderEnabled && latest.emailReminderTime === user.emailReminderTime && latest.emailReminderTimeZone === user.emailReminderTimeZone;
    const mailUnchanged = latest && ["smtpHost", "smtpPort", "smtpUser", "smtpPasswordEncrypted", "smtpFrom"].every((key) => latest[key as keyof typeof latest] === user[key as keyof typeof user]);
    const stillOwned = latest?.emailReminderClaimUntil?.getTime() === claimUntil.getTime() && claimUntil.getTime() > new Date().getTime();
    const stillDue = latest && dueEmailReminderDay({ enabled: latest.emailReminderEnabled, time: latest.emailReminderTime, timeZone: latest.emailReminderTimeZone }, new Date()) === day;
    if (!scheduleUnchanged || !mailUnchanged || !stillOwned || !stillDue) {
      await db.user.updateMany({ where: owned, data: { emailReminderClaimUntil: null } });
      return;
    }
    if (urgent.length) await sendMail(config, { to: config.user, subject: `求职罗盘：${urgent.length} 件事需要关注`, html: renderDigestHtml(urgent) });
    await db.user.updateMany({ where: owned, data: { emailReminderLastDay: day, emailReminderClaimUntil: null, emailReminderLastError: null, ...(urgent.length ? { emailReminderLastSentAt: new Date() } : {}) } });
  } catch (err) {
    console.error("[reminder-digest] scheduled check failed", err);
    if (claimed) await db.user.updateMany({ where: owned, data: { emailReminderClaimUntil: null, emailReminderLastError: err instanceof Error ? err.message : "提醒邮件发送失败" } }).catch(() => {});
  }
}
