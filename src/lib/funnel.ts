import type { ApplicationStage } from "@prisma/client";

/**
 * The pipeline, in order. Deliberately excludes REJECTED / ACCEPTED / DECLINED:
 * those are outcomes, not funnel levels — mixing them in breaks the
 * monotonically-narrowing property a funnel is supposed to have.
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
  /** Conversion from the previous level; null for the first level. */
  stepRate: number | null;
};

export type FunnelOutcomes = {
  offers: number;
  accepted: number;
  rejected: number;
  declined: number;
};

type FunnelApplication = {
  stageHistory: { stage: ApplicationStage }[];
};

/**
 * "Reached" means this stage or any later pipeline stage appears in the
 * history. Counting `currentStage === stage` instead would report 已投递 = 0
 * for someone already at 二面, which is nonsense for a funnel.
 */
function reachedStage(app: FunnelApplication, stageIndex: number): boolean {
  return app.stageHistory.some((h) => {
    const idx = FUNNEL_STAGES.indexOf(h.stage);
    return idx >= stageIndex; // -1 (an outcome stage) never satisfies this
  });
}

export function computeFunnel(apps: FunnelApplication[]): {
  levels: FunnelLevel[];
  total: number;
} {
  const total = apps.length;

  // Only render stages this user's pipeline actually used. Plenty of companies
  // skip the written test entirely; keeping 笔试 as a level would either print a
  // phantom count (depth-based counting credits it to anyone who got further)
  // or print 0 above a larger 一面, which reads as a broken funnel.
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
    });
  });

  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1].count;
    levels[i].stepRate = prev > 0 ? levels[i].count / prev : null;
  }

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
