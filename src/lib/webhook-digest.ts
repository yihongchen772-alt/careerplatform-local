import { db } from "@/lib/db";
import { buildTodos } from "@/lib/todos";
import { loadUpcomingSchedule } from "@/lib/schedule-loader";
import { digestSchedule } from "@/lib/digest-email";
import { dueEmailReminderDay } from "@/lib/email-reminder-schedule";
import {
  readAppSettingsFile,
  readWebhookState,
  writeWebhookState,
} from "@/lib/app-settings-store";
import { notifyWebhookIfConfigured, sendWebhookNotification } from "@/lib/webhook";
import type { PortalSyncResult } from "@/lib/actions/application-sync";
import { STAGE_LABELS } from "@/lib/stage-labels";

type ClaimedEventReminder = {
  id: string;
  title: string;
  startsAt: Date | null;
  meetingInfo: string | null;
  interview: boolean;
};

const CLOCK_FMT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DAY_FMT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});

function formatScheduleWhen(startsAt: string, hasTime: boolean): string {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return startsAt.slice(0, 10);
  return hasTime ? CLOCK_FMT.format(d) : DAY_FMT.format(d);
}

export async function notifyDesktopRemindersWebhook(
  reminders: ClaimedEventReminder[],
): Promise<void> {
  if (reminders.length === 0) return;
  const items = reminders.map((r) => {
    const when = r.startsAt ? CLOCK_FMT.format(new Date(r.startsAt)) : "即将开始";
    const place = r.meetingInfo ? ` · ${r.meetingInfo}` : "";
    return `${r.title}（${when}${place}）`;
  });
  await notifyWebhookIfConfigured({
    event: "interview_reminder",
    title: reminders.some((r) => r.interview) ? `面试 / 日程提醒（${reminders.length} 项）` : `日程提醒（${reminders.length} 项）`,
    body: "以下面试或日程即将开始，请提前做好准备：",
    items,
  });
}

export async function notifyPortalSyncWebhook(result: PortalSyncResult): Promise<void> {
  const expired = result.errors.filter((e) => /登录已过期/.test(e.message));
  if (result.changed.length === 0 && result.review.length === 0 && expired.length === 0) return;
  const items: string[] = [
    ...result.changed.map(
      (c) => `[已更新] ${c.companyName} · ${c.title}：${STAGE_LABELS[c.from] ?? c.from} → ${STAGE_LABELS[c.to] ?? c.to}（官网：${c.portalStatus}）`,
    ),
    ...result.review.map(
      (r) => `[待核对] ${r.companyName} · ${r.title}：官网显示「${r.portalStatus}」`,
    ),
    ...expired.map((e) => `[需重新登录] ${e.companyName}：招聘系统登录已过期`),
  ];
  await notifyWebhookIfConfigured({
    event: "portal_sync",
    title: "网申进度同步播报",
    body: `本次扫描到 ${result.changed.length} 条自动更新、${result.review.length} 条待核对${expired.length ? `、${expired.length} 家需重新登录` : ""}`,
    items,
  });
}

/** Sends at most one daily digest to configured webhook when due time arrives. */
export async function checkWebhookDigestOnTick(userId: string): Promise<void> {
  try {
    const settings = await readAppSettingsFile();
    const webhookUrl = settings.webhookUrl?.trim();
    if (!webhookUrl) return;

    const now = new Date();
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { emailReminderTime: true, emailReminderTimeZone: true },
    });
    const day = dueEmailReminderDay(
      {
        enabled: true,
        time: user?.emailReminderTime || "09:00",
        timeZone: user?.emailReminderTimeZone || "Asia/Shanghai",
      },
      now,
    );
    if (!day) return;

    const state = await readWebhookState();
    if (state.lastDigestDay === day) return;

    const [applications, positions, stageHistories, personalTasks, contacts, calendarEvents, upcoming] =
      await Promise.all([
        db.application.findMany({ where: { userId }, include: { company: true } }),
        db.position.findMany({ where: { userId, status: { not: "APPLIED" } }, include: { company: true } }),
        db.stageHistory.findMany({
          where: { application: { userId }, nextDeadline: { not: null } },
          include: { application: { include: { company: true } } },
        }),
        db.personalTask.findMany({ where: { userId } }),
        db.contact.findMany({
          where: { userId, nextFollowUpAt: { not: null } },
          select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
        }),
        db.calendarEvent.findMany({ where: { userId, completedAt: null } }),
        loadUpcomingSchedule(userId, now, 3),
      ]);

    const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts, calendarEvents);
    const urgent = todos.filter((t) => t.urgency === "overdue" || t.urgency === "urgent");
    const schedule = digestSchedule(upcoming, now.getTime());
    if (urgent.length === 0 && schedule.length === 0) {
      await writeWebhookState({ lastDigestDay: day, lastError: null });
      return;
    }

    const items = [
      ...schedule.map((s) => `[近期日程] ${formatScheduleWhen(s.startsAt, s.hasTime)} · ${s.companyName ? `${s.companyName} ` : ""}${s.title}${s.meetingInfo ? ` (${s.meetingInfo})` : ""}`),
      ...urgent.map((t) => `[紧急待办] ${t.label} — ${t.sublabel}`),
    ];
    const outcome = await sendWebhookNotification(webhookUrl, {
      event: "daily_digest",
      title: `今日求职早报（${day}）`,
      body: `近 3 天有 ${schedule.length} 项日程安排，${urgent.length} 项紧迫待办。`,
      items,
    });
    await writeWebhookState({
      lastDigestDay: outcome.ok ? day : state.lastDigestDay,
      lastError: outcome.ok ? null : outcome.error ?? "发送失败",
    });
  } catch {
    /* Never disrupt local reminder polling loop. */
  }
}
