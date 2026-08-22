export type ScoreBreakdown = {
  techFit?: number;
  salary?: number;
  location?: number;
  growth?: number;
};

const WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  techFit: 0.35,
  salary: 0.25,
  location: 0.2,
  growth: 0.2,
};

/** Weighted 0-100 score from four 0-10 dimension ratings. Missing dimensions are excluded and weights renormalized. */
export function computeInterestScore(breakdown: ScoreBreakdown | null | undefined): number | null {
  if (!breakdown) return null;

  const entries = (Object.keys(WEIGHTS) as (keyof ScoreBreakdown)[]).filter(
    (key) => typeof breakdown[key] === "number"
  );
  if (entries.length === 0) return null;

  const totalWeight = entries.reduce((sum, key) => sum + WEIGHTS[key], 0);
  const weightedSum = entries.reduce(
    (sum, key) => sum + (breakdown[key] as number) * WEIGHTS[key],
    0
  );

  return Math.round(((weightedSum / totalWeight) * 100) / 10);
}
