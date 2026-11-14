import { redirect } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { cohortLabel } from "@/lib/campus-sheet";
import { KIND_OPTIONS, PAGE_SIZE, baseWhere, chipWhere, freshSince, postingsHref, startOfDay, type PostingFilters } from "@/lib/campus-postings-query";
import { PostingSearch, SubscribeCard, SyncControls } from "@/components/leads/postings-controls";
import { PostingsTableClient, type PostingTableRow } from "@/components/leads/postings-table-client";
import type { BatchVariantOption } from "@/components/leads/batch-profile-select";
import { extractProfileSignal, scorePostingMatch } from "@/lib/posting-match";
import { isBuiltinFeedUrl } from "@/lib/builtin-feed";

const STALE_MS = 12 * 3600_000;

function monthDay(date: Date) {
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}

function citiesText(cities: string | null) {
  const list = (cities ?? "").split("、").filter(Boolean);
  return list.length > 3 ? `${list.slice(0, 3).join("、")} 等 ${list.length} 城` : list.join("、");
}

function syncedText(at: Date | null) {
  if (!at) return "还没同步";
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return "刚刚同步";
  if (minutes < 60) return `${minutes} 分钟前同步`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} 小时前同步`;
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日同步`;
}

function atsLabelForUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/mokahr\.com/i.test(url)) return "Moka";
  if (/zhiye\.com/i.test(url)) return "北森";
  if (/jobs\.feishu\.cn|jobs\.bytedance\.com/i.test(url)) return "飞书";
  return null;
}

function profileHighestDegree(applicationProfile: unknown): string | null {
  if (!applicationProfile || typeof applicationProfile !== "object") return null;
  const edu = (applicationProfile as { education?: Array<{ degree?: unknown }> }).education;
  if (!Array.isArray(edu) || !edu.length) return null;
  const first = edu[0]?.degree;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

/**
 * 订阅的招聘信息: a subscribed 校招信息表, filtered on the server (a sheet can
 * hold 10k+ rows). Chips with counts on top like the sheets' own 今日新增 /
 * 快截止 views; each row opens in the 网申浏览器 or goes into the 候选岗位池.
 */
export async function PostingsPanel({
  userId,
  filters,
  profileVariants = [],
}: {
  userId: string;
  filters: PostingFilters;
  profileVariants?: BatchVariantOption[];
}) {
  const [sources, profile, allResumes] = await Promise.all([
    db.postingSource.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.user.findUnique({ where: { id: userId }, select: { graduationYear: true, targetTrack: true, preferredCities: true, skills: true, applicationProfile: true } }),
    db.resumeVersion.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, isDefault: true, extractedText: true, structured: true },
    }),
  ]);
  const source = sources[0] ?? null;
  if (!source) return <SubscribeCard />;
  const hasBuiltinFeed = sources.some((s) => isBuiltinFeedUrl(s.url));
  const hasFeishuSheet = sources.some((s) => !isBuiltinFeedUrl(s.url));
  const combinedTotal = sources.reduce((sum, s) => sum + (s.total || 0), 0);
  const displayTitle = sources.map((s) => s.name || (isBuiltinFeedUrl(s.url) ? "内置名企官网每日直招池" : "校招信息表")).join(" + ");
  const earliestFirstSynced = sources.reduce<Date | null>((min, s) => {
    if (!s.firstSyncedAt) return min;
    return !min || s.firstSyncedAt < min ? s.firstSyncedAt : min;
  }, null);
  const latestSyncedAt = sources.reduce<Date | null>((max, s) => (s.lastSyncedAt && (!max || s.lastSyncedAt > max) ? s.lastSyncedAt : max), null);
  const latestCheckedAt = sources.reduce<Date | null>((max, s) => (s.lastCheckedAt && (!max || s.lastCheckedAt > max) ? s.lastCheckedAt : max), null);
  const syncErrors = sources.map((s) => s.lastError).filter((e): e is string => !!e);

  const activeResume = (filters.resumeId ? allResumes.find((r) => r.id === filters.resumeId) : null) ?? allResumes[0] ?? null;
  const userDegree = profileHighestDegree(profile?.applicationProfile);
  const signal = extractProfileSignal(
    profile ? { ...profile, degree: userDegree } : null,
    activeResume?.extractedText,
    activeResume?.structured
  );
  const now = new Date();
  const today = startOfDay(now);
  const graduationYear = profile?.graduationYear ?? null;
  const base = baseWhere(userId, filters, graduationYear, now);
  const since = freshSince(earliestFirstSynced, now);
  const freshWhere = since ? { firstSeenAt: { gt: since } } : { id: "" };
  const where = { AND: [base, ...(filters.chip ? [chipWhere(filters.chip, now)] : []), ...(filters.fresh ? [freshWhere] : [])] };
  const matchSorting = (filters.sort === "match" && signal.hasSignal) || (hasBuiltinFeed && !filters.chip);

  const [total, todayCount, recentCount, closingCount, industryRows] = await Promise.all([
    db.campusPosting.count({ where }),
    db.campusPosting.count({ where: { AND: [base, chipWhere("today", now)] } }),
    db.campusPosting.count({ where: { AND: [base, chipWhere("recent", now)] } }),
    db.campusPosting.count({ where: { AND: [base, chipWhere("closing", now)] } }),
    db.campusPosting.groupBy({ by: ["industry"], where: { userId }, _count: { _all: true } }),
  ]);

  let rows: Awaited<ReturnType<typeof db.campusPosting.findMany>> = [];
  const scoreMap = new Map<string, ReturnType<typeof scorePostingMatch>>();
  if (matchSorting) {
    const candidates = await db.campusPosting.findMany({
      where,
      select: { id: true, company: true, roles: true, cities: true, industry: true, cohort: true, degree: true, kind: true, note: true, startDate: true },
    });
    const rawRanked = candidates
      .map((item) => {
        const match = signal.hasSignal
          ? scorePostingMatch(
              { companyName: item.company, tracks: item.roles, cities: item.cities, industry: item.industry, graduation: item.cohort, degree: item.degree, description: item.note },
              signal
            )
          : null;
        if (match) scoreMap.set(item.id, match);
        const campusBonus = item.kind && item.kind !== "社招" ? (signal.hasSignal ? 6 : 20) : 0;
        return { id: item.id, company: item.company, score: (match?.score ?? 50) + campusBonus, startMs: item.startDate?.getTime() ?? 0 };
      })
      .sort((a, b) => b.score - a.score || b.startMs - a.startMs);
    // Diversify same-tier companies so no single company floods page 1
    const byCompanyCount = new Map<string, number>();
    const ranked = rawRanked
      .map((item) => {
        const seenCount = byCompanyCount.get(item.company) ?? 0;
        byCompanyCount.set(item.company, seenCount + 1);
        const diversityPenalty = Math.floor(seenCount / 2) * 3;
        return { ...item, effectiveScore: item.score - diversityPenalty };
      })
      .sort((a, b) => b.effectiveScore - a.effectiveScore || b.score - a.score || b.startMs - a.startMs);
    const pageIds = ranked.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE).map((r) => r.id);
    if (pageIds.length > 0) {
      const fetched = await db.campusPosting.findMany({ where: { id: { in: pageIds } } });
      const byId = new Map(fetched.map((row) => [row.id, row]));
      rows = pageIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    }
  } else {
    rows = await db.campusPosting.findMany({
      where,
      orderBy: filters.chip === "closing" ? [{ deadline: "asc" }, { company: "asc" }] : [{ startDate: { sort: "desc", nulls: "last" } }, { company: "asc" }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
  }
  const freshCount = since ? await db.campusPosting.count({ where: { AND: [base, freshWhere] } }) : 0;
  const industryCounts = new Map<string, number>();
  for (const row of industryRows) for (const name of (row.industry ?? "").split("、").filter(Boolean)) industryCounts.set(name, (industryCounts.get(name) ?? 0) + row._count._all);
  const industries = [...industryCounts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A remembered page the table has since shrunk past: its last page, not an empty list.
  if (filters.page > pages) redirect(postingsHref(filters, { page: pages }));
  const cohort = cohortLabel(graduationYear);
  const chips: { id: PostingFilters["chip"]; label: string; count: number }[] = [
    { id: "today", label: "今日新增", count: todayCount },
    { id: "recent", label: "近 3 天新增", count: recentCount },
    { id: "closing", label: "7 天内截止", count: closingCount },
  ];
  const hidden: Record<string, string> = {};
  if (filters.chip) hidden.chip = filters.chip;
  if (filters.kind) hidden.kind = filters.kind;
  if (filters.industry) hidden.industry = filters.industry;
  if (filters.allCohorts) hidden.cohort = "all";
  if (filters.withClosed) hidden.closed = "1";
  if (filters.fresh) hidden.fresh = "1";
  if (filters.sort === "match") hidden.sort = "match";
  if (filters.resumeId) hidden.resumeId = filters.resumeId;
  const pill = (active: boolean) => cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground");

  const tableRows: PostingTableRow[] = rows.map((row) => {
    const daysLeft = row.deadline ? Math.round((row.deadline.getTime() - today.getTime()) / 86400_000) : null;
    const match = signal.hasSignal
      ? scoreMap.get(row.id) ??
        scorePostingMatch(
          { companyName: row.company, tracks: row.roles, cities: row.cities, industry: row.industry, graduation: row.cohort, degree: row.degree, description: row.note },
          signal
        )
      : undefined;
    return {
      id: row.id,
      company: row.company,
      isNew: !!(since && row.firstSeenAt > since),
      atsLabel: atsLabelForUrl(row.applyUrl),
      metaText: [row.industry, row.degree, row.writtenTest].filter(Boolean).join(" · "),
      roles: row.roles,
      note: row.note,
      citiesText: citiesText(row.cities),
      citiesTitle: row.cities,
      cohortKind: [row.cohort, row.kind].filter(Boolean).join(" · "),
      startLabel: row.startDate ? monthDay(row.startDate) : "—",
      startIsToday: !!(row.startDate && row.startDate.getTime() === today.getTime()),
      deadlineLabel: row.deadline
        ? `${monthDay(row.deadline)}${daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 ? `（${daysLeft === 0 ? "今天" : `${daysLeft} 天`}）` : ""}`
        : "",
      deadlineUrgent: daysLeft !== null && daysLeft >= 0 && daysLeft <= 7,
      deadlinePast: daysLeft !== null && daysLeft < 0,
      deadlineNote: row.deadlineText,
      applyUrl: row.applyUrl,
      noticeUrl: row.noticeUrl,
      addedToPool: !!row.positionId,
      match,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={sources.map((s) => s.url).join(" , ")}>{displayTitle}</p>
          <p className="text-xs text-muted-foreground">共 {combinedTotal} 条 · {syncedText(latestSyncedAt)}{latestCheckedAt && latestSyncedAt && latestCheckedAt > latestSyncedAt ? `，${syncedText(latestCheckedAt).replace("同步", "检查过、没有改动")}` : ""}{syncErrors.length ? <span className="text-destructive"> · 上次同步失败：{syncErrors[0]}</span> : null}</p>
        </div>
        <SyncControls
          sourceId={source.id}
          sources={sources.map((s) => ({
            id: s.id,
            name: s.name || (isBuiltinFeedUrl(s.url) ? "内置直招池" : "校招信息表"),
          }))}
          stale={sources.some((s) => !s.lastSyncedAt || now.getTime() - (s.lastCheckedAt ?? s.lastSyncedAt).getTime() > STALE_MS)}
          hasBuiltinFeed={hasBuiltinFeed}
          hasFeishuSheet={hasFeishuSheet}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {chips.map((chip) => (
          <Link key={chip.id} href={postingsHref(filters, { chip: filters.chip === chip.id ? "" : chip.id })} className={cn("rounded-xl border p-3 transition-colors", filters.chip === chip.id ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
            <p className={cn("text-2xl font-semibold tabular-nums", chip.id === "closing" && chip.count ? "text-red-600" : "")}>{chip.count}</p>
            <p className="text-xs text-muted-foreground">{chip.label}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PostingSearch q={filters.q} hidden={hidden} />
        {signal.hasSignal ? (
          <Link href={postingsHref(filters, { sort: filters.sort === "match" ? "" : "match" })} className={pill(filters.sort === "match")} title="按你的意向方向、城市、技能和届次从高到低推荐">
            <Sparkles className="size-3" />
            按我的匹配度推荐
          </Link>
        ) : (
          <Link href="/settings" className={pill(false)} title="去设置里填一下目标岗位和意向城市，就能按匹配度推荐">
            去填求职意向解锁推荐 →
          </Link>
        )}
        {cohort && <Link href={postingsHref(filters, { allCohorts: !filters.allCohorts })} className={pill(!filters.allCohorts)} title="只看写着你这一届、或没写届次的">只看{cohort}</Link>}
        <Link href={postingsHref(filters, { withClosed: !filters.withClosed })} className={pill(filters.withClosed)}>含已截止</Link>
        {(freshCount > 0 || filters.fresh) && <Link href={postingsHref(filters, { fresh: !filters.fresh })} className={pill(filters.fresh)} title="表主最近几天新加进表里的">新加的 {freshCount}</Link>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">类型</span>
        {KIND_OPTIONS.map((kind) => <Link key={kind} href={postingsHref(filters, { kind: filters.kind === kind ? "" : kind })} className={pill(filters.kind === kind)}>{kind}</Link>)}
      </div>
      {allResumes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">按简历算匹配度</span>
          {allResumes.map((r, idx) => {
            const isSelected = activeResume?.id === r.id;
            const nextResumeId = idx === 0 && !filters.resumeId ? r.id : r.id === activeResume?.id ? "" : r.id;
            return (
              <Link key={r.id} href={postingsHref(filters, { resumeId: nextResumeId, sort: "match" })} className={pill(isSelected)}>
                {r.name}
                {r.isDefault ? "（默认）" : ""}
              </Link>
            );
          })}
        </div>
      )}
      {industries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">行业</span>
          {industries.map((name) => <Link key={name} href={postingsHref(filters, { industry: filters.industry === name ? "" : name })} className={pill(filters.industry === name)}>{name}</Link>)}
        </div>
      )}

      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>筛出 {total} 条{total > PAGE_SIZE ? `，第 ${filters.page} / ${pages} 页` : ""}</span>
        {(filters.q || filters.page > 1 || Object.keys(hidden).length > 0) && <Link href="/leads?view=postings" className="text-primary hover:underline">清除筛选</Link>}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">没有符合条件的招聘信息{latestSyncedAt ? "，换个筛选试试" : "，正在同步…"}</p>
      ) : (
        <PostingsTableClient
          rows={tableRows}
          showMatch={signal.hasSignal}
          resumeVersions={allResumes.map(({ id, name, isDefault }) => ({ id, name, isDefault }))}
          profileVariants={profileVariants}
          defaultResumeId={activeResume?.id ?? null}
        />
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {filters.page > 1 ? <Link className="text-primary hover:underline" href={postingsHref(filters, { page: filters.page - 1 })}>上一页</Link> : <span className="text-muted-foreground">上一页</span>}
          <span className="text-muted-foreground tabular-nums">{filters.page} / {pages}</span>
          {filters.page < pages ? <Link className="text-primary hover:underline" href={postingsHref(filters, { page: filters.page + 1 })}>下一页</Link> : <span className="text-muted-foreground">下一页</span>}
        </div>
      )}
    </div>
  );
}
