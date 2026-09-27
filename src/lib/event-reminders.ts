import { randomUUID } from "crypto";
import { db } from "@/lib/db";

/** Leased claims prevent overlapping timers; delivery is acknowledged only after Electron shows it. */
export async function claimEventReminders(userId: string, now = new Date()) {
  const claimToken = randomUUID();
  const reminders = await db.$transaction(async (tx) => {
    const due = await tx.eventReminder.findMany({ where: { event: { userId }, deliveredAt: null, scheduledAt: { lte: now }, OR: [{ claimUntil: null }, { claimUntil: { lt: now } }] }, orderBy: { scheduledAt: "asc" }, take: 100, include: { event: true } });
    const result = [];
    for (const reminder of due) {
      const claimed = await tx.eventReminder.updateMany({ where: { id: reminder.id, deliveredAt: null, OR: [{ claimUntil: null }, { claimUntil: { lt: now } }] }, data: { claimToken, claimUntil: new Date(now.getTime() + 120000) } });
      if (claimed.count) result.push({ id: reminder.id, title: reminder.event.title, scheduledAt: reminder.scheduledAt });
    }
    return result;
  });
  return { claimToken, reminders };
}
export async function acknowledgeEventReminders(userId: string, ids: string[], claimToken: string) {
  return db.eventReminder.updateMany({ where: { id: { in: ids }, claimToken, event: { userId }, deliveredAt: null }, data: { deliveredAt: new Date(), claimUntil: null, claimToken: null } });
}
