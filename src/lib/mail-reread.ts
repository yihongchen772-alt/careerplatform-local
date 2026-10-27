import { db } from "@/lib/db";
import { getUserScanAccounts, fetchEmailsByUid } from "@/lib/imap";
import { mailTime } from "@/lib/mail-time";
import { completeMailDraft, EXAM_OR_INTERVIEW } from "@/lib/mail-time-extract";
import { matchMailApplication } from "@/lib/mail-application-match";
import { applyMailSchedule } from "@/lib/mail-schedule";
import type { ApplicationStage } from "@prisma/client";

/**
 * Reads mail a second time. A 面试 / 笔试 mail whose time the first reading
 * missed (the AI left the time out; the time came in an unusual wording) is
 * fetched again by its UID and read with the rule-based reader, and the time
 * goes on the calendar like any other. Nothing in the mailbox is changed.
 */

const TERMINAL: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"];
const DAY = 86_400_000;

export type RereadResult = { checked: number; filled: number; scheduled: number; linked: number; failures: string[] };

export async function rereadMailTimes(userId: string, options: { days?: number; now?: Date } = {}): Promise<RereadResult> {
  const now = options.now ?? new Date();
  const result: RereadResult = { checked: 0, filled: 0, scheduled: 0, linked: 0, failures: [] };
  const since = new Date(now.getTime() - (options.days ?? 30) * DAY);
  const tasks = (await db.personalTask.findMany({
    where: { userId, sourceMailKey: { not: null }, done: false, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null, createdAt: { gte: since } },
    select: { id: true, title: true, note: true, mailEventDraft: true, applicationId: true, sourceMailKey: true },
    orderBy: { createdAt: "desc" },
    take: 80,
  })).filter((task) => EXAM_OR_INTERVIEW.test(task.title) && !mailTime(task.mailEventDraft));
  if (!tasks.length) return result;

  const accounts = new Map((await getUserScanAccounts(userId)).map((account) => [account.id, account]));
  const autoApply = (await db.user.findUnique({ where: { id: userId }, select: { autoApplyProgress: true } }))?.autoApplyProgress ?? false;
  const apps = autoApply
    ? (await db.application.findMany({
        where: { userId, currentStage: { notIn: TERMINAL } },
        select: { id: true, title: true, company: { select: { name: true, aliases: { select: { alias: true } } } } },
        take: 300,
      })).map((app) => ({ id: app.id, title: app.title, companyName: app.company.name, aliases: app.company.aliases.map((entry) => entry.alias) }))
    : [];

  const byAccount = new Map<string, { uid: number; task: (typeof tasks)[number] }[]>();
  for (const task of tasks) {
    const at = task.sourceMailKey!.lastIndexOf(":");
    const accountId = task.sourceMailKey!.slice(0, at);
    const uid = Number(task.sourceMailKey!.slice(at + 1));
    if (!accounts.has(accountId) || !Number.isSafeInteger(uid)) continue;
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), { uid, task }]);
  }

  for (const [accountId, entries] of byAccount) {
    const account = accounts.get(accountId)!;
    let emails;
    try {
      emails = await fetchEmailsByUid(account, entries.map((entry) => entry.uid));
    } catch (error) {
      console.error(`[mail-reread] ${account.label} failed`, error);
      result.failures.push(`「${account.label}」读取失败`);
      continue;
    }
    const byUid = new Map(emails.map((email) => [email.uid, email]));
    for (const { uid, task } of entries) {
      const email = byUid.get(uid);
      if (!email) continue;
      result.checked += 1;
      const [type, company] = task.title.split("：");
      const draft = email.calendarInvite
        ? { ...email.calendarInvite, title: email.calendarInvite.title || task.title }
        : completeMailDraft({ ai: task.mailEventDraft as Record<string, string> | null, subject: email.subject, body: email.snippet, mailDate: email.date, type, company });
      if (!draft || !mailTime(draft)) continue;
      const matched = task.applicationId ?? matchMailApplication({ subject: email.subject, company, body: email.snippet }, apps);
      await db.personalTask.update({ where: { id: task.id }, data: { mailEventDraft: draft, ...(matched && !task.applicationId ? { applicationId: matched } : {}) } });
      result.filled += 1;
      if (matched && !task.applicationId) result.linked += 1;
      if (!autoApply) continue;
      try {
        const placed = await db.$transaction((tx) => applyMailSchedule(tx, { taskId: task.id, userId, stage: null, now }));
        if (placed.status === "stage" || placed.status === "event") result.scheduled += 1;
      } catch (error) {
        console.error("[mail-reread] schedule write failed", error);
      }
    }
  }
  return result;
}
