import type { Prisma } from "@prisma/client";
import { cohortLabel } from "@/lib/campus-sheet";

/**
 * The 订阅的招聘信息 list's filters, read from the page address so every
 * view can be linked and the back button works: q (search), chip (今日新增 /
 * 近3天 / 7天内截止), kind, industry, cohort=all (every 届次), closed=1
 * (include past deadlines), fresh=1 (added to the sheet since it was first synced), page.
 */
export type PostingFilters = { q: string; chip: "" | "today" | "recent" | "closing"; kind: string; industry: string; allCohorts: boolean; withClosed: boolean; fresh: boolean; sort: "" | "match"; page: number };

/** How long a row the sheet's owner added stays marked 新. */
export const FRESH_DAYS = 3;

export const PAGE_SIZE = 50;
export const KIND_OPTIONS = ["秋招", "秋招提前批", "秋招补录", "春招", "暑期实习", "实习", "人才计划"];

export function readPostingFilters(params: Record<string, string | string[] | undefined>): PostingFilters {
  const one = (key: string) => { const value = params[key]; return (Array.isArray(value) ? value[0] : value ?? "").trim().slice(0, 60); };
  const chip = one("chip");
  return {
    q: one("q"),
    chip: chip === "today" || chip === "recent" || chip === "closing" ? chip : "",
    kind: one("kind"),
    industry: one("industry"),
    allCohorts: one("cohort") === "all",
    withClosed: one("closed") === "1",
    fresh: one("fresh") === "1",
    sort: one("sort") === "match" ? "match" : "",
    page: Math.max(1, Math.min(1000, Number(one("page")) || 1)),
  };
}

export function startOfDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Everything but the chip: what the chips' counts are taken over. */
export function baseWhere(userId: string, filters: PostingFilters, graduationYear: number | null, now = new Date()): Prisma.CampusPostingWhereInput {
  const today = startOfDay(now);
  const and: Prisma.CampusPostingWhereInput[] = [{ userId }];
  const cohort = cohortLabel(graduationYear);
  // A row with no 届次 written is usually for everyone graduating this season.
  if (cohort && !filters.allCohorts) and.push({ OR: [{ cohort: null }, { cohort: { contains: cohort } }] });
  if (!filters.withClosed) and.push({ OR: [{ deadline: null }, { deadline: { gte: today } }] });
  if (filters.kind) and.push({ kind: { contains: filters.kind } });
  if (filters.industry) and.push({ industry: { contains: filters.industry } });
  if (filters.q) {
    for (const word of filters.q.split(/\s+/).filter(Boolean).slice(0, 4)) {
      and.push({ OR: [{ company: { contains: word } }, { roles: { contains: word } }, { cities: { contains: word } }, { industry: { contains: word } }, { note: { contains: word } }] });
    }
  }
  return { AND: and };
}

export function chipWhere(chip: PostingFilters["chip"], now = new Date()): Prisma.CampusPostingWhereInput {
  const today = startOfDay(now);
  if (chip === "today") return { startDate: { gte: today } };
  if (chip === "recent") return { startDate: { gte: new Date(today.getTime() - 2 * 86400_000) } };
  if (chip === "closing") return { deadline: { gte: today, lt: new Date(today.getTime() + 8 * 86400_000) } };
  return {};
}

/** The page address for these filters with some changed (a chip clicked again turns it off). */
export function postingsHref(filters: PostingFilters, change: Partial<PostingFilters>): string {
  const next = { ...filters, page: 1, ...change };
  const params = new URLSearchParams({ view: "postings" });
  if (next.q) params.set("q", next.q);
  if (next.chip) params.set("chip", next.chip);
  if (next.kind) params.set("kind", next.kind);
  if (next.industry) params.set("industry", next.industry);
  if (next.allCohorts) params.set("cohort", "all");
  if (next.withClosed) params.set("closed", "1");
  if (next.fresh) params.set("fresh", "1");
  if (next.sort === "match") params.set("sort", "match");
  if (next.page > 1) params.set("page", String(next.page));
  return `/leads?${params}`;
}

/** Rows first seen after the sheet's first sync, in the last few days: what its owner just added. */
export function freshSince(firstSyncedAt: Date | null, now = new Date()): Date | null {
  if (!firstSyncedAt) return null;
  const window = new Date(now.getTime() - FRESH_DAYS * 86400_000);
  return firstSyncedAt > window ? firstSyncedAt : window;
}
