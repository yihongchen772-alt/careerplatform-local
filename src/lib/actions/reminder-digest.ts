"use server";

import { dueEmailReminderDay } from "@/lib/email-reminder-schedule";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { buildTodos, type Todo } from "@/lib/todos";
import { getUserMailConfig, sendMail } from "@/lib/mailer";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { loadUpcomingSchedule } from "@/lib/schedule-loader";
import { digestSchedule, renderDigestEmail } from "@/lib/digest-email";

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

    const now = new Date();
    const todos = await collectTodos(user.id);
    const schedule = digestSchedule(await loadUpcomingSchedule(user.id, now, 3), now.getTime());
    const mail = renderDigestEmail({ todos, schedule, now: now.getTime() });
    await sendMail(config, {
      to: config.user,
      subject: mail?.subject ?? "求职罗盘：一切正常",
      html: mail?.html ?? `<div style="font-family:sans-serif;"><h2>求职罗盘</h2><p>暂时没有要处理的事，保持住 👍</p></div>`,
    });

    return { count: todos.length + schedule.length };
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
    // Sent on a day with an interview or 笔试 coming up too, not only when
    // something is overdue — it is the morning summary to read on the phone.
    const schedule = digestSchedule(await loadUpcomingSchedule(userId, now, 3), now.getTime());
    const mail = renderDigestEmail({ todos: urgent, schedule, now: now.getTime() });
    const latest = await db.user.findUnique({ where: { id: userId } });
    const scheduleUnchanged = latest && latest.emailReminderEnabled && latest.emailReminderTime === user.emailReminderTime && latest.emailReminderTimeZone === user.emailReminderTimeZone;
    const mailUnchanged = latest && ["smtpHost", "smtpPort", "smtpUser", "smtpPasswordEncrypted", "smtpFrom"].every((key) => latest[key as keyof typeof latest] === user[key as keyof typeof user]);
    const stillOwned = latest?.emailReminderClaimUntil?.getTime() === claimUntil.getTime() && claimUntil.getTime() > new Date().getTime();
    const stillDue = latest && dueEmailReminderDay({ enabled: latest.emailReminderEnabled, time: latest.emailReminderTime, timeZone: latest.emailReminderTimeZone }, new Date()) === day;
    if (!scheduleUnchanged || !mailUnchanged || !stillOwned || !stillDue) {
      await db.user.updateMany({ where: owned, data: { emailReminderClaimUntil: null } });
      return;
    }
    if (mail) await sendMail(config, { to: config.user, subject: mail.subject, html: mail.html });
    await db.user.updateMany({ where: owned, data: { emailReminderLastDay: day, emailReminderClaimUntil: null, emailReminderLastError: null, ...(mail ? { emailReminderLastSentAt: new Date() } : {}) } });
  } catch (err) {
    console.error("[reminder-digest] scheduled check failed", err);
    if (claimed) await db.user.updateMany({ where: owned, data: { emailReminderClaimUntil: null, emailReminderLastError: err instanceof Error ? err.message : "提醒邮件发送失败" } }).catch(() => {});
  }
}
