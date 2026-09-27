export const TERMINATION_STAGES = ["REJECTED", "WITHDRAWN", "CANCELLED"] as const;
export function terminationFields(stage: string, previous: string | null, label?: string | null) {
  const ended = TERMINATION_STAGES.includes(stage as typeof TERMINATION_STAGES[number]);
  const valid = previous && ![...TERMINATION_STAGES, "ACCEPTED", "DECLINED"].includes(previous);
  return {
    terminatedAtStage: ended && valid ? previous : null,
    terminatedAtStageLabel: ended && valid ? label || null : null,
  };
}
