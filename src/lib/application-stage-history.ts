import type { Prisma } from "@prisma/client";

/** Choose the current event by effective date, not the last write request. */
export function latestStageEntry<T extends { id: string; stage: string; enteredAt: Date }>(entries: T[], appliedDate: Date): T | undefined {
  const ordered = [...entries].sort((left, right) =>
    right.enteredAt.getTime() - left.enteredAt.getTime() || right.id.localeCompare(left.id)
  );
  // The initial APPLIED event is a date-only timestamp; on a UTC+ timezone it
  // can appear after a real same-day update. Treat it as the baseline.
  return ordered.find((entry) => !(entry.stage === "APPLIED" && entry.enteredAt.getTime() === appliedDate.getTime())) ?? ordered[0];
}

/**
 * Recomputes the application's current stage from whatever history remains.
 * Called after an add, edit or delete: currentStage is a denormalised copy of
 * "the newest history row", and leaving it pointing at a row that was just
 * changed or removed is how the record silently starts lying.
 */
export async function resyncCurrentStage(tx: Prisma.TransactionClient, applicationId: string): Promise<void> {
  const application = await tx.application.findUnique({
    where: { id: applicationId },
    select: { appliedDate: true, currentStage: true, currentStageLabel: true, currentStageDate: true },
  });
  if (!application) return;
  const history = await tx.stageHistory.findMany({ where: { applicationId } });
  // The first APPLIED event contains a date-only value (UTC midnight), which
  // can sort after a real event on that same local day. Treat it as the
  // baseline, then choose the latest dated event among everything else.
  const latest = latestStageEntry(history, application.appliedDate);
  if (!latest) return;
  const stageChanged = application.currentStage !== latest.stage || application.currentStageLabel !== latest.stageLabel;
  if (!stageChanged && application.currentStageDate.getTime() === latest.enteredAt.getTime()) return;
  await tx.application.update({
    where: { id: applicationId },
    data: {
      currentStage: latest.stage,
      currentStageLabel: latest.stageLabel,
      currentStageDate: latest.enteredAt,
      ...(stageChanged ? { portalSuggestedStage: null, portalSuggestedAt: null } : {}),
    },
  });
}
