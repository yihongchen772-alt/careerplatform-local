import type { ApplicationStage } from "@prisma/client";

/**
 * Quick filters over 投递记录 — the numbers on the cards are also the way
 * in: 「面试阶段 4」 opens those four. Kept in the address (?f=) so coming
 * back from a 投递 shows the same list.
 */
export const APPLICATION_FILTERS = ["all", "active", "applied", "exam", "interview", "interviewed", "waiting", "offer", "stale", "rejected", "closed"] as const;
export type ApplicationFilter = (typeof APPLICATION_FILTERS)[number];

/** Same threshold as the 待办's 「该催一下 HR 了」. */
export const STALE_DAYS = 14;

export const FILTER_LABELS: Record<ApplicationFilter, string> = {
  all: "全部",
  active: "进行中",
  applied: "等筛选",
  exam: "笔试测评",
  interview: "面试中",
  interviewed: "进过面试",
  waiting: "等结果",
  offer: "Offer",
  stale: "久未更新",
  rejected: "未通过",
  closed: "已结束",
};

export const FILTER_HINTS: Record<ApplicationFilter, string> = {
  all: "所有投递",
  active: "还没结束的流程",
  applied: "已投递、筛选中，还没有下一步",
  exam: "测评、笔试阶段",
  interview: "一面到 HR 面",
  interviewed: "面过至少一轮，含后来没过、拿到 Offer 的",
  waiting: "面完 / 考完，在等公司结果",
  offer: "拿到 Offer 的（含已接受 / 已拒绝）",
  stale: `进行中、${STALE_DAYS} 天以上没有新进展`,
  rejected: "企业未通过",
  closed: "未通过、撤回、岗位取消、已接受或已拒绝",
};

const TERMINAL: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"];
const EXAM: ApplicationStage[] = ["ASSESSMENT", "OA"];
const INTERVIEW: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"];
const OFFER: ApplicationStage[] = ["OFFER", "ACCEPTED", "DECLINED"];

/**
 * The last interview round a 投递 got to (一面 < 二面 < 三面 < HR 面), from
 * what was actually recorded — so one that failed 二面 counts as 二面, not 一面,
 * and an Offer with no recorded interview counts as none. A 投递 now back at
 * 已投递 / 笔试 had its interview step undone by hand, so it has none.
 */
export function furthestInterview(currentStage: ApplicationStage, history: { stage: ApplicationStage }[]): ApplicationStage | null {
  if (!TERMINAL.includes(currentStage) && !INTERVIEW.includes(currentStage) && !OFFER.includes(currentStage)) return null;
  let best = -1;
  for (const stage of [currentStage, ...history.map((row) => row.stage)]) best = Math.max(best, INTERVIEW.indexOf(stage));
  return best >= 0 ? INTERVIEW[best] : null;
}

const ROUNDS: { stage: ApplicationStage; label: string }[] = [
  { stage: "INTERVIEW_1", label: "一面" },
  { stage: "INTERVIEW_2", label: "二面" },
  { stage: "INTERVIEW_3", label: "三面" },
  { stage: "HR_INTERVIEW", label: "HR 面" },
];

// How an interviewed 投递 stands now.
const OUTCOMES: { key: string; label: string; match: (stage: ApplicationStage) => boolean }[] = [
  { key: "going", label: "还在面 / 等结果", match: (stage) => !TERMINAL.includes(stage) && !OFFER.includes(stage) },
  { key: "failed", label: "没过", match: (stage) => stage === "REJECTED" },
  { key: "offer", label: "Offer", match: (stage) => OFFER.includes(stage) },
  { key: "closed", label: "撤回 / 取消", match: (stage) => stage === "WITHDRAWN" || stage === "CANCELLED" },
];

/**
 * 进过面试 by the last round reached × how it stands now: a 投递 that failed
 * 二面 sits in the 二面 row, not 一面, so each row reads "面到这一轮为止".
 */
export function interviewBreakdown(apps: { currentStage: ApplicationStage; interviewReach?: ApplicationStage | null }[]) {
  const interviewed = apps.filter((app) => app.interviewReach);
  const rows = ROUNDS.map((round) => {
    const items = interviewed.filter((app) => app.interviewReach === round.stage);
    const cells = Object.fromEntries(OUTCOMES.map((outcome) => [outcome.key, items.filter((app) => outcome.match(app.currentStage)).length])) as Record<string, number>;
    return { ...round, total: items.length, cells };
  });
  const columns = OUTCOMES.map(({ key, label }) => ({ key, label, total: rows.reduce((sum, row) => sum + row.cells[key], 0) }));
  // 一面 and 二面 always; later rounds once someone got there.
  const lastRow = Math.max(1, ...rows.map((row, index) => (row.total ? index : -1)));
  return { total: interviewed.length, rows: rows.slice(0, lastRow + 1), columns: columns.filter((column) => column.total || column.key !== "closed") };
}

export function parseFilter(value: string | null | undefined): ApplicationFilter {
  return (APPLICATION_FILTERS as readonly string[]).includes(value ?? "") ? (value as ApplicationFilter) : "all";
}

type FilterApplication = { currentStage: ApplicationStage; currentStageDate: string | Date; waiting?: boolean; interviewReach?: ApplicationStage | null };

export function matchesFilter(app: FilterApplication, filter: ApplicationFilter, now: number): boolean {
  const stage = app.currentStage;
  switch (filter) {
    case "all": return true;
    case "active": return !TERMINAL.includes(stage);
    case "applied": return stage === "APPLIED" || stage === "SCREENING";
    case "exam": return EXAM.includes(stage);
    case "interview": return INTERVIEW.includes(stage);
    case "interviewed": return !!app.interviewReach;
    case "waiting": return !TERMINAL.includes(stage) && !!app.waiting;
    case "offer": return OFFER.includes(stage);
    case "stale": {
      if (TERMINAL.includes(stage)) return false;
      const since = new Date(app.currentStageDate).getTime();
      return Math.floor((now - since) / 86_400_000) >= STALE_DAYS;
    }
    case "rejected": return stage === "REJECTED";
    case "closed": return TERMINAL.includes(stage);
  }
}

export function filterCounts(apps: FilterApplication[], now: number): Record<ApplicationFilter, number> {
  const counts = Object.fromEntries(APPLICATION_FILTERS.map((filter) => [filter, 0])) as Record<ApplicationFilter, number>;
  for (const app of apps) for (const filter of APPLICATION_FILTERS) if (matchesFilter(app, filter, now)) counts[filter] += 1;
  return counts;
}
