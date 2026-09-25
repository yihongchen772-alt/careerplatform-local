import type { ApplicationStage } from "@prisma/client";

/**
 * Owned here, not in analytics.ts — analytics.ts imports FUNNEL_STAGES/
 * reachedStage from this file, so this file must not import anything back
 * from analytics.ts (a circular import between the two previously caused a
 * real "Cannot access 'FUNNEL_STAGES' before initialization" crash,
 * depending on which page's module graph happened to evaluate first).
 * analytics.ts re-exports this constant so existing `from "@/lib/analytics"`
 * imports elsewhere keep working unchanged.
 */
export const SMALL_SAMPLE_THRESHOLD = 5;

/**
 * Display order only. Company workflows can skip or reorder these steps;
 * never infer that reaching a later display row means completing earlier ones.
 */
export const FUNNEL_STAGES: ApplicationStage[] = [
  "APPLIED",
  "SCREENING",
  "ASSESSMENT",
  "OA",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "INTERVIEW_3",
  "HR_INTERVIEW",
  "OFFER",
];

export type FunnelLevel = {
  stage: ApplicationStage;
  /** Applications that ever reached this stage (not "currently sitting here"). */
  count: number;
  /** Share of all applications, used for bar width. */
  shareOfTotal: number;
  /** Kept for existing callers; no per-step conversion without one shared order. */
  stepRate: number | null;
  smallSample: boolean;
};

export type FunnelOutcomes = {
  offers: number;
  accepted: number;
  rejected: number;
  declined: number;
};

export type FunnelApplication = {
  stageHistory: { stage: ApplicationStage }[];
};

/**
 * "Reached" means the stage was actually recorded in history. Do not credit
 * skipped company-specific steps based on an assumed global order.
 */
export function reachedStage(app: FunnelApplication, stageIndex: number): boolean {
  const stage = FUNNEL_STAGES[stageIndex];
  return !!stage && app.stageHistory.some((h) => h.stage === stage);
}

export function computeFunnel(apps: FunnelApplication[]): {
  levels: FunnelLevel[];
  total: number;
} {
  const total = apps.length;

  // Only render stages that actually occurred. Counts are independent, so
  // a later display row may be larger than an earlier one.
  const occurred = new Set(apps.flatMap((a) => a.stageHistory.map((h) => h.stage)));

  const levels: FunnelLevel[] = [];
  FUNNEL_STAGES.forEach((stage, i) => {
    if (!occurred.has(stage)) return;
    const count = apps.filter((a) => reachedStage(a, i)).length;
    levels.push({
      stage,
      count,
      shareOfTotal: total > 0 ? count / total : 0,
      stepRate: null,
      smallSample: count < SMALL_SAMPLE_THRESHOLD,
    });
  });

  return { levels, total };
}

export function computeOutcomes(
  apps: { currentStage: ApplicationStage }[]
): FunnelOutcomes {
  const by = (s: ApplicationStage) =>
    apps.filter((a) => a.currentStage === s).length;
  return {
    offers: by("OFFER"),
    accepted: by("ACCEPTED"),
    rejected: by("REJECTED"),
    declined: by("DECLINED"),
  };
}
