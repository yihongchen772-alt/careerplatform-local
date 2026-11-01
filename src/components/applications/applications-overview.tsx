"use client";

import type { ReactNode } from "react";
import type { ApplicationStage } from "@prisma/client";
import { ChevronDown, Clock, Send, Trophy, Video, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STALE_DAYS, interviewBreakdown, type ApplicationFilter } from "@/lib/application-filters";
import { useStoredChoice } from "@/components/applications/use-stored-choice";

type OverviewApplication = { currentStage: ApplicationStage; appliedDate: string; currentStageDate: string; waiting?: boolean; interviewReach?: ApplicationStage | null; company: { name: string } };

const TERMINAL: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"];

// One row per place a 投递 can be in now; each row is also the filter that opens those 投递.
const ROWS: { label: string; hint: string; filter: ApplicationFilter; bar: string; match: (app: OverviewApplication) => boolean }[] = [
  { label: "已投递 · 筛选中", hint: "等简历反馈", filter: "applied", bar: "bg-primary/60", match: (app) => app.currentStage === "APPLIED" || app.currentStage === "SCREENING" },
  { label: "测评 · 笔试", hint: "含考完等结果", filter: "exam", bar: "bg-sky-500/70", match: (app) => app.currentStage === "ASSESSMENT" || app.currentStage === "OA" },
  { label: "面试中", hint: "一面到 HR 面", filter: "interview", bar: "bg-violet-500/70", match: (app) => ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"].includes(app.currentStage) },
  { label: "Offer", hint: "含已接受 / 已拒绝", filter: "offer", bar: "bg-emerald-500/70", match: (app) => ["OFFER", "ACCEPTED", "DECLINED"].includes(app.currentStage) },
  { label: "未通过", hint: "企业未通过", filter: "rejected", bar: "bg-rose-500/60", match: (app) => app.currentStage === "REJECTED" },
  { label: "撤回 · 岗位取消", hint: "流程没走完", filter: "closed", bar: "bg-slate-400/70", match: (app) => app.currentStage === "WITHDRAWN" || app.currentStage === "CANCELLED" },
];

const DAY = 86_400_000;

// Interview outcome columns that get a colour.
const OUTCOME_TONE: Record<string, string> = { failed: "text-rose-600 dark:text-rose-400", offer: "text-emerald-600 dark:text-emerald-400" };

/**
 * 投递情况总表: the 总览's numbers, here next to the 投递 themselves — and every
 * number opens the 投递 it counts. `funnel` is the shared 阶段覆盖 card.
 */
export function ApplicationsOverview({ applications, now, filter, onFilter, funnel }: { applications: OverviewApplication[]; now: number; filter: ApplicationFilter; onFilter: (filter: ApplicationFilter) => void; funnel?: ReactNode }) {
  const [open, setOpen] = useStoredChoice("careerplatform.applications.overview", ["open", "closed"] as const, "open");
  const total = applications.length;
  if (!total) return null;
  const weekAgo = now - 7 * DAY;
  const active = applications.filter((app) => !TERMINAL.includes(app.currentStage));
  const interviewing = applications.filter(ROWS[2].match).length;
  const interviews = interviewBreakdown(applications);
  const offers = applications.filter(ROWS[3].match).length;
  const closed = total - active.length;
  const companies = new Set(applications.map((app) => app.company.name)).size;
  const newThisWeek = applications.filter((app) => new Date(app.appliedDate).getTime() >= weekAgo).length;
  // Heard back at all: anything past 已投递 / 筛选中.
  const answered = applications.filter((app) => !ROWS[0].match(app)).length;
  const rows = ROWS.map((row) => {
    const items = applications.filter(row.match);
    // 未通过 that came after an interview, so 「14 条未通过」 doesn't read as 14 简历挂.
    const afterInterview = row.filter === "rejected" ? items.filter((app) => app.interviewReach).length : 0;
    return {
      ...row,
      hint: afterInterview ? `${row.hint} · 其中 ${afterInterview} 条是面试后` : row.hint,
      count: items.length,
      movedThisWeek: items.filter((app) => new Date(app.currentStageDate).getTime() >= weekAgo).length,
      stale: items.filter((app) => !TERMINAL.includes(app.currentStage) && now - new Date(app.currentStageDate).getTime() >= STALE_DAYS * DAY).length,
    };
  });

  return (
    <section className="space-y-4" aria-label="投递情况总表">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">投递情况总表</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {total} 条投递 · {companies} 家公司 · 近 7 天新投 {newThisWeek} 条 · 有回音 {Math.round((answered / total) * 100)}%
          </p>
        </div>
        <button type="button" onClick={() => setOpen(open === "open" ? "closed" : "open")} aria-expanded={open === "open"} className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {open === "open" ? "收起" : "展开"}
          <ChevronDown className={cn("size-3.5 transition-transform", open === "open" && "rotate-180")} />
        </button>
      </div>
      {open === "open" && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Tile label="总投递" value={total} icon={Send} tone="brand" selected={filter === "all"} onClick={() => onFilter("all")} />
          <Tile label="进行中" value={active.length} icon={Clock} tone="amber" selected={filter === "active"} onClick={() => onFilter("active")} />
          <Tile label="进过面试" value={interviews.total} note={interviewing ? `现在在面 ${interviewing}` : undefined} icon={Video} tone="brand" selected={filter === "interviewed"} onClick={() => onFilter("interviewed")} />
          <Tile label="Offer" value={offers} icon={Trophy} tone="emerald" selected={filter === "offer"} onClick={() => onFilter("offer")} />
          <Tile label="已结束" value={closed} icon={XCircle} tone="slate" selected={filter === "closed"} onClick={() => onFilter("closed")} />
        </div>
        <div className={cn("grid gap-4", funnel && "xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]")}>
          <div className="surface-card overflow-hidden rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">现在在哪一步</th>
                  <th className="px-2 py-2.5 text-right font-medium">数量</th>
                  <th className="hidden w-[32%] px-3 py-2.5 font-medium sm:table-cell">占比</th>
                  <th className="px-2 py-2.5 text-right font-medium">近 7 天变动</th>
                  <th className="px-4 py-2.5 text-right font-medium">{STALE_DAYS} 天没动静</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    onClick={() => row.count && onFilter(row.filter)}
                    className={cn("border-b border-border/40 last:border-0 transition-colors", row.count ? "cursor-pointer hover:bg-muted/50" : "text-muted-foreground", filter === row.filter && row.filter !== "all" && "bg-primary/5")}
                  >
                    <td className="px-4 py-2.5">
                      <button type="button" disabled={!row.count} onClick={(event) => { event.stopPropagation(); onFilter(row.filter); }} className="text-left font-medium disabled:font-normal">
                        {row.label}
                      </button>
                      <span className="ml-2 hidden text-xs text-muted-foreground md:inline">{row.hint}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{row.count}</td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full", row.bar)} style={{ width: `${(row.count / total) * 100}%` }} />
                        </div>
                        <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{Math.round((row.count / total) * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{row.movedThisWeek || "—"}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", row.stale ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                      {row.stale ? <button type="button" onClick={(event) => { event.stopPropagation(); onFilter("stale"); }} className="hover:underline" title="打开所有久未更新的投递">{row.stale}</button> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4">
            {interviews.total > 0 && <InterviewTable breakdown={interviews} total={total} selected={filter === "interviewed"} onOpen={() => onFilter("interviewed")} />}
            {funnel}
          </div>
        </div>
      </>}
    </section>
  );
}

function InterviewTable({ breakdown, total, selected, onOpen }: { breakdown: ReturnType<typeof interviewBreakdown>; total: number; selected: boolean; onOpen: () => void }) {
  return (
    <div className={cn("surface-card overflow-hidden rounded-xl", selected && "ring-2 ring-primary/30")} aria-label="面试走到哪一轮">
      <button type="button" onClick={onOpen} className="block w-full px-4 pt-3 text-left">
        <span className="text-sm font-semibold">进过面试 {breakdown.total} 条</span>
        <span className="ml-2 text-xs text-muted-foreground">占全部 {Math.round((breakdown.total / total) * 100)}% · 按面到的最后一轮算，二面没过记在二面</span>
      </button>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-xs text-muted-foreground">
            <th className="px-4 py-2 text-left font-medium">面到</th>
            {breakdown.columns.map((column) => <th key={column.key} className="px-2 py-2 text-right font-medium">{column.label}</th>)}
            <th className="px-4 py-2 text-right font-medium">合计</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.rows.map((row) => (
            <tr key={row.stage} onClick={() => row.total && onOpen()} className={cn("border-b border-border/40 last:border-0", row.total ? "cursor-pointer hover:bg-muted/50" : "text-muted-foreground")}>
              <td className="px-4 py-2 font-medium">{row.label}</td>
              {breakdown.columns.map((column) => {
                const value = row.cells[column.key];
                return <td key={column.key} className={cn("px-2 py-2 text-right tabular-nums", value ? OUTCOME_TONE[column.key] : "text-muted-foreground")}>{value || "—"}</td>;
              })}
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{row.total || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, note, icon: Icon, tone, selected, onClick }: { label: string; value: number; note?: string; icon: LucideIcon; tone: "brand" | "amber" | "emerald" | "slate"; selected: boolean; onClick: () => void }) {
  return (
    // stat-tile + data-tone: the same pastel tiles as 总览 (globals.css).
    <button type="button" onClick={onClick} aria-pressed={selected} data-tone={tone} className={cn("stat-tile surface-card flex min-h-24 flex-col justify-between rounded-xl px-4 py-3 text-left transition-all hover:-translate-y-0.5", selected && "ring-2 ring-primary/40")}>
      <span className="flex items-center justify-between text-sm font-medium text-muted-foreground">{label}<Icon className="size-4" /></span>
      <span className="flex items-baseline gap-2"><span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>{note && <span className="text-xs text-muted-foreground">{note}</span>}</span>
    </button>
  );
}
