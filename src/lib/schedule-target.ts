import type { ApplicationStage, Prisma } from "@prisma/client";
import { currentStageRow, isTerminalStage } from "@/lib/interview-schedule";
import { classifyAutoTransition } from "@/lib/application-flow";
import { writeAutoStage } from "@/lib/auto-progress";
import { resyncCurrentStage } from "@/lib/application-stage-history";

/**
 * Which step a new time goes on. A time is for a round (一面, 测评…): on the
 * current step when the 投递 is at that round, otherwise on a new step for
 * it — so an interview booked while still 「已投递」 moves the 投递 to 一面
 * instead of hanging the time on 「已投递」.
 *
 * - `manual`: the user picked the round; any round they were offered is fine.
 * - `forward`: the round was read from a mail or a title; only a move
 *   forward is made (an old mail about an earlier round must not drag the
 *   投递 back). `auto` records it as a recognised update, with 撤销.
 *
 * Returns null when there is no such step to use (a closed 投递, or a round
 * behind the current one in `forward` mode).
 */
export async function rowForSchedule(
  tx: Prisma.TransactionClient,
  applicationId: string,
  stage: ApplicationStage,
  mode: { kind: "manual" } | { kind: "forward"; auto?: { evidence: string; note: string } }
): Promise<{ rowId: string; created: boolean } | null> {
  const app = await tx.application.findUnique({
    where: { id: applicationId },
    select: { currentStage: true, currentStageLabel: true, currentStageDate: true, stageHistory: { select: { id: true, stage: true, enteredAt: true } } },
  });
  if (!app || isTerminalStage(app.currentStage)) return null;
  if (stage === app.currentStage) {
    const row = currentStageRow(app, app.stageHistory);
    return row ? { rowId: row.id, created: false } : null;
  }
  if (mode.kind === "forward" && classifyAutoTransition(app.currentStage, stage) !== "apply") return null;
  if (mode.kind === "forward" && mode.auto) {
    const rowId = await writeAutoStage(tx, {
      applicationId,
      stage,
      stageLabel: null,
      enteredAt: new Date(),
      note: mode.auto.note,
      source: "email",
      evidence: mode.auto.evidence,
      previousStage: app.currentStage,
      previousLabel: app.currentStageLabel,
    });
    return { rowId, created: true };
  }
  const row = await tx.stageHistory.create({ data: { applicationId, stage, enteredAt: new Date() } });
  await resyncCurrentStage(tx, applicationId);
  return { rowId: row.id, created: true };
}
