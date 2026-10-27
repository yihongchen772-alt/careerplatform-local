import type { ApplicationStage } from "@prisma/client";
import { SMALL_SAMPLE_THRESHOLD, type FunnelApplication } from "@/lib/funnel";

// Re-exported so existing `from "@/lib/analytics"` imports elsewhere keep
// working — the actual constant is owned by funnel.ts, see the comment
// there for why (breaking a circular import between the two files).
export { SMALL_SAMPLE_THRESHOLD };

const ASSESSMENT_STAGES: ApplicationStage[] = ["ASSESSMENT", "OA"];
const INTERVIEW_STAGES: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"];
const OFFER_STAGES: ApplicationStage[] = ["OFFER", "ACCEPTED"];
// Past 简历筛选 in any way (a 笔试 counts): what 岗位机会评分 reads as "they responded".
const ENGAGED_STAGES: ApplicationStage[] = ["OA", ...INTERVIEW_STAGES, ...OFFER_STAGES];

export type ConversionRow = {
  key: string;
  total: number;
  /** Reached 笔试 or beyond — not necessarily an interview. */
  engaged: number;
  engagedRate: number;
  /** Got as far as a 笔试 or 测评. */
  assessed: number;
  /** Got as far as an interview round (一面 … HR 面). */
  interviewed: number;
  offers: number;
  assessedRate: number;
  interviewedRate: number;
  offerRate: number;
  smallSample: boolean;
};

type AnalyticsApplication = {
  currentStage: ApplicationStage;
  stageHistory: { stage: ApplicationStage }[];
  source: string | null;
  position: { track: string | null } | null;
  /** 行业 / 城市 the page worked out for this 投递; null when unknown (left out of that grouping). */
  industry?: string | null;
  city?: string | null;
};

// A rejected application still counts as having reached an interview if it
// ever got there, so this reads the full history as well as where it sits
// now — currentStage alone would say REJECTED and undercount every group.
// Only recorded steps count: an interview is never assumed from an offer.
function reached(app: AnalyticsApplication, stages: ApplicationStage[]): boolean {
  return stages.includes(app.currentStage) || app.stageHistory.some((h) => stages.includes(h.stage));
}

function summarize(key: string, apps: AnalyticsApplication[]): ConversionRow {
  const total = apps.length;
  const assessed = apps.filter((a) => reached(a, ASSESSMENT_STAGES)).length;
  const interviewed = apps.filter((a) => reached(a, INTERVIEW_STAGES)).length;
  const offers = apps.filter((a) => reached(a, OFFER_STAGES)).length;
  const engaged = apps.filter((a) => reached(a, ENGAGED_STAGES)).length;
  return {
    key,
    total,
    engaged,
    engagedRate: total > 0 ? engaged / total : 0,
    assessed,
    interviewed,
    offers,
    assessedRate: total > 0 ? assessed / total : 0,
    interviewedRate: total > 0 ? interviewed / total : 0,
    offerRate: total > 0 ? offers / total : 0,
    smallSample: total < SMALL_SAMPLE_THRESHOLD,
  };
}

function groupBy(
  apps: AnalyticsApplication[],
  keyOf: (app: AnalyticsApplication) => string | null | undefined
): ConversionRow[] {
  const buckets = new Map<string, AnalyticsApplication[]>();
  for (const app of apps) {
    const key = keyOf(app)?.trim();
    if (!key) continue; // an unlabeled row would form a meaningless "未填写" cohort
    const list = buckets.get(key) ?? [];
    list.push(app);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .map(([key, list]) => summarize(key, list))
    // A group with enough 投递 to mean something comes before a tiny one that happens to be 100%.
    .sort((a, b) => Number(a.smallSample) - Number(b.smallSample) || b.interviewedRate - a.interviewedRate || b.offerRate - a.offerRate || b.total - a.total);
}

export function computeConversion(apps: AnalyticsApplication[]) {
  return {
    bySource: groupBy(apps, (a) => a.source),
    byTrack: groupBy(apps, (a) => a.position?.track),
    byIndustry: groupBy(apps, (a) => a.industry),
    byCity: groupBy(apps, (a) => a.city),
  };
}

/**
 * One plain sentence about a grouping: the group that reached interviews most
 * often among those with enough 投递 to compare. Null when nothing qualifies
 * (every group small, or none reached an interview) — no reading is better than a wrong one.
 */
export function bestGroupLine(rows: ConversionRow[]): string | null {
  const solid = rows.filter((row) => !row.smallSample && row.interviewed > 0);
  if (solid.length < 2) return null;
  const best = solid[0];
  return `${best.key}进面最多：${best.total} 家里有 ${best.interviewed} 家（${formatPercent(best.interviewedRate)}）`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

// The stage-by-stage funnel (APPLIED → ... → OFFER) lives in src/lib/funnel.ts,
// shared by /dashboard and /insights — it is not duplicated here.

export type ResumeComparisonRow = {
  name: string;
  total: number;
  assessment: number;
  interview: number;
  offers: number;
  assessmentRate: number;
  interviewRate: number;
  offerRate: number;
  smallSample: boolean;
};

/**
 * Per-resume-version breakdown with a "笔试" (assessment) column the generic
 * ConversionRow above doesn't have — the whole point of comparing resume
 * versions is seeing which actual steps occurred. Do not assume that an
 * interview implies a prior written test or assessment.
 */
export function computeResumeComparison(
  apps: (FunnelApplication & { resumeVersion: { name: string } | null })[]
): ResumeComparisonRow[] {
  const buckets = new Map<string, typeof apps>();
  for (const app of apps) {
    const name = app.resumeVersion?.name;
    if (!name) continue;
    const list = buckets.get(name) ?? [];
    list.push(app);
    buckets.set(name, list);
  }
  return [...buckets.entries()]
    .map(([name, list]) => {
      const total = list.length;
      const assessment = list.filter((a) => a.stageHistory.some((h) => ASSESSMENT_STAGES.includes(h.stage))).length;
      const interview = list.filter((a) => a.stageHistory.some((h) => INTERVIEW_STAGES.includes(h.stage))).length;
      // Offers use the same OFFER_STAGES definition as the rest of this
      // file (folds in ACCEPTED), not reachedStage — an application logged
      // straight to ACCEPTED with no separate OFFER row shouldn't undercount.
      const offers = list.filter((a) =>
        a.stageHistory.some((h) => OFFER_STAGES.includes(h.stage))
      ).length;
      return {
        name,
        total,
        assessment,
        interview,
        offers,
        assessmentRate: total > 0 ? assessment / total : 0,
        interviewRate: total > 0 ? interview / total : 0,
        offerRate: total > 0 ? offers / total : 0,
        smallSample: total < SMALL_SAMPLE_THRESHOLD,
      };
    })
    .sort((a, b) => b.interviewRate - a.interviewRate || b.total - a.total);
}
