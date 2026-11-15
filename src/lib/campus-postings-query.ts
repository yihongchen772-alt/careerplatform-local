import type { Prisma } from "@prisma/client";
import { cohortLabel } from "@/lib/campus-sheet";
import type { AtsPlatformId } from "@/lib/ats-platform";

/**
 * The 订阅的招聘信息 list's filters, read from the page address so every
 * view can be linked and the back button works: q (search), chip (今日新增 /
 * 近3天 / 7天内截止), kind, industry, platform (ATS 平台 / 仅可一键填表),
 * unadded=1 (仅看未加入候选池), cohort=all (every 届次), closed=1
 * (include past deadlines), fresh=1 (added to the sheet since it was first synced), page.
 */
export type PostingFilters = {
  q: string;
  chip: "" | "today" | "recent" | "closing";
  kind: string;
  industry: string;
  platform: AtsPlatformId;
  hideAdded: boolean;
  allCohorts: boolean;
  withClosed: boolean;
  fresh: boolean;
  sort: "" | "match";
  resumeId: string;
  page: number;
};

/** How long a row the sheet's owner added stays marked 新. */
export const FRESH_DAYS = 3;

export const PAGE_SIZE = 50;
export const KIND_OPTIONS = ["秋招", "秋招提前批", "秋招补录", "春招", "暑期实习", "实习", "人才计划", "社招"];

const VALID_PLATFORMS = new Set<AtsPlatformId>(["autofill", "feishu", "moka", "beisen", "dayee", "majors", "global"]);

export function readPostingFilters(params: Record<string, string | string[] | undefined>): PostingFilters {
  const one = (key: string) => { const value = params[key]; return (Array.isArray(value) ? value[0] : value ?? "").trim().slice(0, 60); };
  const chip = one("chip");
  const rawPlatform = one("platform") as AtsPlatformId;
  return {
    q: one("q"),
    chip: chip === "today" || chip === "recent" || chip === "closing" ? chip : "",
    kind: one("kind"),
    industry: one("industry"),
    platform: VALID_PLATFORMS.has(rawPlatform) ? rawPlatform : "",
    hideAdded: one("unadded") === "1",
    allCohorts: one("cohort") === "all",
    withClosed: one("closed") === "1",
    fresh: one("fresh") === "1",
    sort: one("sort") === "match" ? "match" : "",
    resumeId: one("resumeId"),
    page: Math.max(1, Math.min(1000, Number(one("page")) || 1)),
  };
}

export function startOfDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const PLATFORM_CONDITIONS: Record<Exclude<AtsPlatformId, "" | "autofill">, Prisma.CampusPostingWhereInput[]> = {
  feishu: [{ applyUrl: { contains: "jobs.feishu.cn" } }, { applyUrl: { contains: "jobs.bytedance.com" } }],
  moka: [{ applyUrl: { contains: "mokahr.com" } }],
  beisen: [{ applyUrl: { contains: "zhiye.com" } }],
  dayee: [
    { applyUrl: { contains: "hotjob.cn" } },
    { applyUrl: { contains: "dayee.com" } },
    { applyUrl: { contains: "/pb/posDetail" } },
    { applyUrl: { contains: "/pb/school" } },
    { applyUrl: { contains: "/pb/index" } },
  ],
  majors: [
    { applyUrl: { contains: "careers.tencent.com" } },
    { applyUrl: { contains: "join.qq.com" } },
    { applyUrl: { contains: "alibaba.com" } },
    { applyUrl: { contains: "aliyun.com" } },
    { applyUrl: { contains: "zhaopin.meituan.com" } },
  ],
  global: [
    { applyUrl: { contains: "greenhouse.io" } },
    { applyUrl: { contains: "lever.co" } },
    { applyUrl: { contains: "ashbyhq.com" } },
  ],
};

export function platformWhere(platform: AtsPlatformId): Prisma.CampusPostingWhereInput | null {
  if (!platform) return null;
  if (platform === "autofill") {
    return {
      OR: [
        ...PLATFORM_CONDITIONS.feishu,
        ...PLATFORM_CONDITIONS.moka,
        ...PLATFORM_CONDITIONS.beisen,
        ...PLATFORM_CONDITIONS.dayee,
      ],
    };
  }
  const or = PLATFORM_CONDITIONS[platform];
  return or?.length ? { OR: or } : null;
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
  if (filters.hideAdded) and.push({ positionId: null });
  const plat = platformWhere(filters.platform);
  if (plat) and.push(plat);
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
  if (next.platform) params.set("platform", next.platform);
  if (next.hideAdded) params.set("unadded", "1");
  if (next.allCohorts) params.set("cohort", "all");
  if (next.withClosed) params.set("closed", "1");
  if (next.fresh) params.set("fresh", "1");
  if (next.sort === "match") params.set("sort", "match");
  if (next.resumeId) params.set("resumeId", next.resumeId);
  if (next.page > 1) params.set("page", String(next.page));
  return `/leads?${params}`;
}

/** Rows first seen after the sheet's first sync, in the last few days: what its owner just added. */
export function freshSince(firstSyncedAt: Date | null, now = new Date()): Date | null {
  if (!firstSyncedAt) return null;
  const window = new Date(now.getTime() - FRESH_DAYS * 86400_000);
  return firstSyncedAt > window ? firstSyncedAt : window;
}
