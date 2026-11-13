/**
 * History oldest first, as a timeline shows it. The first APPLIED row is
 * date-only (UTC midnight = 08:00 in UTC+8): a 测评 recorded at 05:00 that
 * same day must still come after it, not before.
 */
export function orderStageHistory<T extends { id: string; stage: string; enteredAt: Date }>(entries: T[], appliedDate: Date): T[] {
  const baseline = (entry: T) => entry.stage === "APPLIED" && entry.enteredAt.getTime() === appliedDate.getTime();
  return [...entries].sort((left, right) => Number(baseline(right)) - Number(baseline(left)) || left.enteredAt.getTime() - right.enteredAt.getTime() || left.id.localeCompare(right.id));
}
