import { cityGroup, MULTI_CITY, NO_CITY } from "@/lib/application-city";
import { compareCompanyNames } from "@/lib/application-search";
import { NO_INDUSTRY } from "@/lib/company-industry";

/**
 * Ways to lay 投递记录 out in sections — by company, city or the week it was
 * sent — and the time window it can be narrowed to. Both work on a list that
 * is already filtered and sorted: sections keep that order inside.
 */
export const GROUP_KINDS = ["none", "company", "city", "industry", "week"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const GROUP_LABELS: Record<GroupKind, string> = {
  none: "不分组",
  company: "按公司",
  city: "按城市",
  industry: "按行业",
  week: "按投递时间",
};

export type Groupable = {
  appliedDate: string;
  cities: string[];
  /** See industryLabel; missing counts as 未分类. */
  industry?: string;
};

export type Group<T> = { key: string; label: string; hint?: string; items: T[] };

const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Monday 00:00 of the week `ms` falls in. */
function startOfWeek(ms: number): number {
  const day = new Date(startOfDay(ms));
  const sinceMonday = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - sinceMonday).getTime();
}

function md(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** Whole days from the day `iso` was sent to today (0 = today). */
export function daysAgo(iso: string, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso).getTime())) / DAY);
}

function byWeek<T extends Groupable>(items: T[], now: number): Group<T>[] {
  const thisWeek = startOfWeek(now);
  const groups = new Map<string, { start: number; group: Group<T> }>();
  for (const item of items) {
    const sent = new Date(item.appliedDate).getTime();
    const weeksBack = Math.round((thisWeek - startOfWeek(sent)) / (7 * DAY));
    let key: string;
    let label: string;
    let hint: string | undefined;
    let start: number;
    if (weeksBack <= 7) {
      start = startOfWeek(sent);
      key = `w${start}`;
      label = weeksBack <= 0 ? "本周" : weeksBack === 1 ? "上周" : `${md(start)} – ${md(start + 6 * DAY)}`;
      if (weeksBack <= 1) hint = `${md(start)} – ${md(start + 6 * DAY)}`;
    } else {
      // Further back a week is too fine; a month will do.
      const date = new Date(sent);
      start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      key = `m${start}`;
      label = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
    }
    const found = groups.get(key);
    if (found) found.group.items.push(item);
    else groups.set(key, { start, group: { key, label, hint, items: [item] } });
  }
  return [...groups.values()].sort((a, b) => b.start - a.start).map((entry) => entry.group);
}

function byCity<T extends Groupable>(items: T[]): Group<T>[] {
  const groups = new Map<string, Group<T>>();
  for (const item of items) {
    const label = cityGroup(item.cities);
    const found = groups.get(label);
    if (found) found.items.push(item);
    else groups.set(label, { key: `c${label}`, label, hint: label === MULTI_CITY ? "岗位写了三个以上城市，之后再选" : label === NO_CITY ? "岗位没写地点，可以勾选后批量补上" : undefined, items: [item] });
  }
  const tail = (label: string) => (label === NO_CITY ? 2 : label === MULTI_CITY ? 1 : 0);
  return [...groups.values()].sort((a, b) => tail(a.label) - tail(b.label) || b.items.length - a.items.length || compareCompanyNames(a.label, b.label));
}

function byIndustry<T extends Groupable>(items: T[]): Group<T>[] {
  const groups = new Map<string, Group<T>>();
  for (const item of items) {
    const label = item.industry || NO_INDUSTRY;
    const found = groups.get(label);
    if (found) found.items.push(item);
    else groups.set(label, { key: `i${label}`, label, hint: label === NO_INDUSTRY ? "这些公司还没有行业" : undefined, items: [item] });
  }
  return [...groups.values()].sort((a, b) => Number(a.label === NO_INDUSTRY) - Number(b.label === NO_INDUSTRY) || b.items.length - a.items.length || compareCompanyNames(a.label, b.label));
}

/** Companies with several 岗位 each get a section; the single ones share one. */
function byCompany<T extends Groupable>(items: T[], companyOf: (item: T) => string): Group<T>[] {
  const companies = new Map<string, T[]>();
  for (const item of items) {
    const list = companies.get(companyOf(item));
    if (list) list.push(item);
    else companies.set(companyOf(item), [item]);
  }
  const several: Group<T>[] = [];
  const single: T[] = [];
  for (const [name, list] of companies) {
    if (list.length > 1) several.push({ key: `p${name}`, label: name, hint: `${list.length} 个岗位`, items: list });
    else single.push(list[0]);
  }
  several.sort((a, b) => b.items.length - a.items.length || compareCompanyNames(a.label, b.label));
  single.sort((a, b) => compareCompanyNames(companyOf(a), companyOf(b)));
  if (single.length) several.push({ key: "p-single", label: "只投了 1 个岗位的公司", hint: `${single.length} 家`, items: single });
  return several;
}

export function groupApplications<T extends Groupable>(items: T[], kind: GroupKind, now: number, companyOf: (item: T) => string): Group<T>[] {
  if (kind === "company") return byCompany(items, companyOf);
  if (kind === "city") return byCity(items);
  if (kind === "industry") return byIndustry(items);
  if (kind === "week") return byWeek(items, now);
  return [{ key: "all", label: "全部", items }];
}

/** The window of 投递日期 a list can be narrowed to. */
export const TIME_WINDOWS = ["all", "today", "3d", "7d", "30d"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const TIME_LABELS: Record<TimeWindow, string> = {
  all: "全部时间",
  today: "今天投的",
  "3d": "近 3 天",
  "7d": "近 7 天",
  "30d": "近 30 天",
};

const WINDOW_DAYS: Record<Exclude<TimeWindow, "all">, number> = { today: 0, "3d": 2, "7d": 6, "30d": 29 };

/** Either a window above or one calendar month, "m:2026-09". */
export function parseTime(value: string | null | undefined): string {
  if (!value) return "all";
  return (TIME_WINDOWS as readonly string[]).includes(value) || /^m:\d{4}-\d{2}$/.test(value) ? value : "all";
}

export function monthKey(iso: string): string {
  const date = new Date(iso);
  return `m:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.slice(2).split("-");
  return `${year} 年 ${Number(month)} 月`;
}

export function inTimeWindow(appliedDate: string, window: string, now: number): boolean {
  if (window === "all") return true;
  if (window.startsWith("m:")) return monthKey(appliedDate) === window;
  const limit = WINDOW_DAYS[window as Exclude<TimeWindow, "all">];
  if (limit === undefined) return true;
  const ago = daysAgo(appliedDate, now);
  // A date set in the future still counts as "recent".
  return ago <= limit;
}

/** Months that have 投递, newest first, for the time menu. */
export function monthsPresent(appliedDates: string[]): string[] {
  return [...new Set(appliedDates.map(monthKey))].sort().reverse();
}
