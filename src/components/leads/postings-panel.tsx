import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { cohortLabel } from "@/lib/campus-sheet";
import { KIND_OPTIONS, PAGE_SIZE, baseWhere, chipWhere, freshSince, postingsHref, startOfDay, type PostingFilters } from "@/lib/campus-postings-query";
import { AddToPoolButton, PostingSearch, SubscribeCard, SyncControls } from "@/components/leads/postings-controls";

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

/**
 * 订阅的招聘信息: a subscribed 校招信息表, filtered on the server (a sheet can
 * hold 10k+ rows). Chips with counts on top like the sheets' own 今日新增 /
 * 快截止 views; each row opens in the 网申浏览器 or goes into the 候选岗位池.
 */
export async function PostingsPanel({ userId, filters }: { userId: string; filters: PostingFilters }) {
  const [source, profile] = await Promise.all([
    db.postingSource.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.user.findUnique({ where: { id: userId }, select: { graduationYear: true } }),
  ]);
  if (!source) return <SubscribeCard />;

  const now = new Date();
  const today = startOfDay(now);
  const graduationYear = profile?.graduationYear ?? null;
  const base = baseWhere(userId, filters, graduationYear, now);
  const since = freshSince(source.firstSyncedAt, now);
  const freshWhere = since ? { firstSeenAt: { gt: since } } : { id: "" };
  const where = { AND: [base, ...(filters.chip ? [chipWhere(filters.chip, now)] : []), ...(filters.fresh ? [freshWhere] : [])] };
  const [rows, total, todayCount, recentCount, closingCount, industryRows] = await Promise.all([
    db.campusPosting.findMany({ where, orderBy: filters.chip === "closing" ? [{ deadline: "asc" }, { company: "asc" }] : [{ startDate: { sort: "desc", nulls: "last" } }, { company: "asc" }], skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.campusPosting.count({ where }),
    db.campusPosting.count({ where: { AND: [base, chipWhere("today", now)] } }),
    db.campusPosting.count({ where: { AND: [base, chipWhere("recent", now)] } }),
    db.campusPosting.count({ where: { AND: [base, chipWhere("closing", now)] } }),
    db.campusPosting.groupBy({ by: ["industry"], where: { userId }, _count: { _all: true } }),
  ]);
  const freshCount = since ? await db.campusPosting.count({ where: { AND: [base, freshWhere] } }) : 0;
  const industryCounts = new Map<string, number>();
  for (const row of industryRows) for (const name of (row.industry ?? "").split("、").filter(Boolean)) industryCounts.set(name, (industryCounts.get(name) ?? 0) + row._count._all);
  const industries = [...industryCounts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
  const pill = (active: boolean) => cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={source.url}>{source.name || "校招信息表"}</p>
          <p className="text-xs text-muted-foreground">共 {source.total} 条 · {syncedText(source.lastSyncedAt)}{source.lastCheckedAt && source.lastSyncedAt && source.lastCheckedAt > source.lastSyncedAt ? `，${syncedText(source.lastCheckedAt).replace("同步", "检查过、没有改动")}` : ""}{source.lastError ? <span className="text-destructive"> · 上次同步失败：{source.lastError}</span> : null}</p>
        </div>
        <SyncControls sourceId={source.id} stale={!source.lastSyncedAt || now.getTime() - (source.lastCheckedAt ?? source.lastSyncedAt).getTime() > STALE_MS} />
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
        {cohort && <Link href={postingsHref(filters, { allCohorts: !filters.allCohorts })} className={pill(!filters.allCohorts)} title="只看写着你这一届、或没写届次的">只看{cohort}</Link>}
        <Link href={postingsHref(filters, { withClosed: !filters.withClosed })} className={pill(filters.withClosed)}>含已截止</Link>
        {(freshCount > 0 || filters.fresh) && <Link href={postingsHref(filters, { fresh: !filters.fresh })} className={pill(filters.fresh)} title="表主最近几天新加进表里的">新加的 {freshCount}</Link>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">类型</span>
        {KIND_OPTIONS.map((kind) => <Link key={kind} href={postingsHref(filters, { kind: filters.kind === kind ? "" : kind })} className={pill(filters.kind === kind)}>{kind}</Link>)}
      </div>
      {industries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">行业</span>
          {industries.map((name) => <Link key={name} href={postingsHref(filters, { industry: filters.industry === name ? "" : name })} className={pill(filters.industry === name)}>{name}</Link>)}
        </div>
      )}

      <p className="text-xs text-muted-foreground">筛出 {total} 条{total > PAGE_SIZE ? `，第 ${filters.page} / ${pages} 页` : ""}</p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">没有符合条件的招聘信息{source.lastSyncedAt ? "，换个筛选试试" : "，正在同步…"}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">公司</th>
                <th className="px-3 py-2 font-medium">岗位方向</th>
                <th className="px-3 py-2 font-medium">地点</th>
                <th className="px-3 py-2 font-medium">届次 · 类型</th>
                <th className="px-3 py-2 font-medium">发布</th>
                <th className="px-3 py-2 font-medium">截止</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const daysLeft = row.deadline ? Math.round((row.deadline.getTime() - today.getTime()) / 86400_000) : null;
                return (
                  <tr key={row.id} className="border-t align-top">
                    <td className="max-w-48 px-3 py-2">
                      <p className="font-medium">{row.company}{since && row.firstSeenAt > since && <span className="ml-1.5 rounded bg-red-500/10 px-1 py-px align-middle text-[10px] font-medium text-red-600">新</span>}</p>
                      <p className="text-xs text-muted-foreground">{[row.industry, row.degree, row.writtenTest].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="max-w-72 px-3 py-2"><p className="line-clamp-2 text-xs leading-relaxed whitespace-pre-line" title={[row.roles, row.note].filter(Boolean).join("\n\n")}>{row.roles || row.note || "—"}</p></td>
                    <td className="max-w-40 px-3 py-2 text-xs" title={row.cities ?? undefined}>{citiesText(row.cities) || "—"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">{[row.cohort, row.kind].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{row.startDate ? (row.startDate.getTime() === today.getTime() ? <span className="font-medium text-primary">今天</span> : monthDay(row.startDate)) : "—"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{row.deadline ? <span className={cn(daysLeft !== null && daysLeft < 0 ? "text-muted-foreground line-through" : daysLeft !== null && daysLeft <= 7 ? "font-medium text-red-600" : "")}>{monthDay(row.deadline)}{daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 ? `（${daysLeft === 0 ? "今天" : `${daysLeft} 天`}）` : ""}</span> : <span className="text-muted-foreground">{row.deadlineText || "—"}</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {row.applyUrl && <Link href={`/browser?url=${encodeURIComponent(row.applyUrl)}`} className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">投递<ExternalLink className="size-3" /></Link>}
                        {row.noticeUrl && row.noticeUrl !== row.applyUrl && <Link href={`/browser?url=${encodeURIComponent(row.noticeUrl)}`} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground" title="招聘公告"><FileText className="size-3" />公告</Link>}
                        <AddToPoolButton postingId={row.id} added={!!row.positionId} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
