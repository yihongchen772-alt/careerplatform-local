/** Choose the current event by effective date, not the last write request. */
export function latestStageEntry<T extends { id: string; stage: string; enteredAt: Date }>(entries: T[], appliedDate: Date): T | undefined {
  const ordered = [...entries].sort((left, right) =>
    right.enteredAt.getTime() - left.enteredAt.getTime() || right.id.localeCompare(left.id)
  );
  // The initial APPLIED event is a date-only timestamp; on a UTC+ timezone it
  // can appear after a real same-day update. Treat it as the baseline.
  return ordered.find((entry) => !(entry.stage === "APPLIED" && entry.enteredAt.getTime() === appliedDate.getTime())) ?? ordered[0];
}
