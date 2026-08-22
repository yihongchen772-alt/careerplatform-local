export type LikertValue = 1 | 2 | 3 | 4 | 5;

export type TestItem = {
  id: string;
  text: string;
  /** Which dimension this item scores toward. */
  dimension: string;
  /** True if 5=strongly disagree should score as if 1=strongly agree. */
  reverse?: boolean;
};

export type DimensionMeta = {
  key: string;
  label: string;
  description: string;
};

export type TestResultDetail = {
  dimension: string;
  label: string;
  score: number;
  text: string;
};

export type TestInterpretation = {
  label: string;
  summary: string;
  details: TestResultDetail[];
};

export type TestDefinition = {
  id: "OCEAN" | "MBTI" | "DISC" | "HOLLAND";
  title: string;
  subtitle: string;
  dimensions: DimensionMeta[];
  items: TestItem[];
  scale: { min: LikertValue; max: LikertValue; minLabel: string; maxLabel: string };
  score: (answers: Record<string, LikertValue>) => Record<string, number>;
  interpret: (scores: Record<string, number>) => TestInterpretation;
};

/** Shared 5-point Likert → 0-100 normalizer, reverse-aware. */
export function likertToScore(value: LikertValue, reverse: boolean | undefined, scaleMax = 5): number {
  const v = reverse ? scaleMax + 1 - value : value;
  return ((v - 1) / (scaleMax - 1)) * 100;
}

/** Average the 0-100 per-item scores for every item tagged with `dimension`. */
export function averageByDimension(
  items: TestItem[],
  answers: Record<string, LikertValue>,
  scaleMax = 5
): Record<string, number> {
  const sums: Record<string, { total: number; count: number }> = {};
  for (const item of items) {
    const answer = answers[item.id];
    if (!answer) continue;
    const score = likertToScore(answer, item.reverse, scaleMax);
    sums[item.dimension] ??= { total: 0, count: 0 };
    sums[item.dimension].total += score;
    sums[item.dimension].count += 1;
  }
  const result: Record<string, number> = {};
  for (const [dim, { total, count }] of Object.entries(sums)) {
    result[dim] = count > 0 ? Math.round(total / count) : 0;
  }
  return result;
}
