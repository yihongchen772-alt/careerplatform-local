import { db } from "@/lib/db";
import { itemEndMs, scheduleKindOf } from "@/lib/interview-schedule";
import { STAGE_LABELS } from "@/lib/stage-labels";
import type { JourneyEvent } from "@/lib/journey";
import { IMPORT_NOTE_PREFIX } from "@/lib/application-import";

const WEEK = 7 * 86_400_000;

/** What happened in the last week that is worth a line: results, and interviews that have ended. */
export async function loadJourneyEvents(userId: string, now: number): Promise<JourneyEvent[]> {
  const since = new Date(now - WEEK);
  const [results, timed] = await Promise.all([
    db.stageHistory.findMany({
      where: { stage: { in: ["REJECTED", "OFFER"] }, enteredAt: { gte: since }, application: { userId } },
      select: { stage: true, enteredAt: true, note: true, application: { select: { company: { select: { name: true } } } } },
    }),
    db.stageHistory.findMany({
      where: { nextHasTime: true, nextDeadline: { gte: new Date(now - WEEK - 86_400_000), lte: new Date(now) }, application: { userId } },
      select: { stage: true, stageLabel: true, nextDeadline: true, nextDeadlineEnd: true, application: { select: { company: { select: { name: true } } } } },
    }),
  ]);
  const events: JourneyEvent[] = [];
  for (const row of results) {
    // A result an import wrote down is history, not news.
    if (row.note?.startsWith(IMPORT_NOTE_PREFIX)) continue;
    const company = row.application.company.name;
    events.push(row.stage === "OFFER"
      ? { about: `${company} · Offer`, kind: "offer", at: row.enteredAt.toISOString() }
      : { about: `${company} · 未通过`, kind: "rejected", at: row.enteredAt.toISOString() });
  }
  for (const row of timed) {
    if (!row.nextDeadline || scheduleKindOf(row.stage) !== "interview") continue;
    const end = itemEndMs({ startsAt: row.nextDeadline.toISOString(), endsAt: row.nextDeadlineEnd?.toISOString() ?? null, hasTime: true });
    if (end > now || now - end > WEEK) continue;
    events.push({ about: `${row.application.company.name} · ${row.stageLabel?.trim() || STAGE_LABELS[row.stage]}`, kind: "interview", at: new Date(end).toISOString() });
  }
  return events;
}
