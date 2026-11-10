"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock3, Send } from "lucide-react";
import type { ApplicationStage } from "@prisma/client";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { applicationStageStyle } from "@/lib/application-stage-style";
import { cn } from "@/lib/utils";
import { QuickStageMenu } from "@/components/applications/quick-stage-menu";
import { Highlight } from "@/components/applications/highlight";
import { rememberListOrder } from "@/components/applications/list-order";
import { ProgressLine } from "@/components/schedule/next-schedule";
import type { ApplicationHits } from "@/lib/application-search";
import type { Group } from "@/lib/application-groups";
import { cityHint } from "@/lib/application-city";
import { GroupHeader, groupSummary } from "@/components/applications/group-header";
import type { ScheduleItem, StepView } from "@/lib/interview-schedule";

export type BoardApplication = {
  id: string;
  companyName: string;
  title: string;
  currentStage: ApplicationStage;
  currentStageLabel?: string | null;
  terminatedAtStage?: string | null;
  terminatedAtStageLabel?: string | null;
  appliedDate: string;
  currentStageDate: string;
  cities?: string[];
  citySource?: string | null;
  industry?: string;
  waiting?: boolean;
  /** The step's time or deadline that matters now (see nextScheduleItem). */
  nextSchedule: ScheduleItem | null;
  step: StepView | null;
  portalStatus?: string | null;
  portalSuggestedStage?: ApplicationStage | null;
};

// These are broad buckets, not a prescribed order. A company may skip or
// repeat a step; the detailed timeline is maintained per application.
const LANES: { title: string; description: string; stages: ApplicationStage[] }[] = [
  { title: "投递与筛选", description: "等待申请与简历反馈", stages: ["APPLIED", "SCREENING"] },
  { title: "测评与笔试", description: "含 AI 面试，可跳过，也可能在面试后", stages: ["ASSESSMENT", "OA", "AI_INTERVIEW"] },
  { title: "面试", description: "轮次和顺序由企业决定", stages: ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"] },
  { title: "Offer", description: "录用意向或待签约", stages: ["OFFER"] },
];

const OUTCOMES: { title: string; stage: ApplicationStage; className: string }[] = [
  { title: "流程已终止 / 主动撤回", stage: "WITHDRAWN", className: "text-muted-foreground" },
  { title: "流程已终止 / 岗位取消", stage: "CANCELLED", className: "text-muted-foreground" },
  { title: "未通过 / 公司拒绝", stage: "REJECTED", className: "text-rose-700 dark:text-rose-300" },
  { title: "已接受", stage: "ACCEPTED", className: "text-emerald-700 dark:text-emerald-300" },
  { title: "本人拒绝", stage: "DECLINED", className: "text-muted-foreground" },
];

function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86400000));
}

function ApplicationCard({ app, closed = false, hit, now }: { app: BoardApplication; closed?: boolean; hit?: ApplicationHits; now: number }) {
  const tone = applicationStageStyle(app.currentStage);
  const detail = app.currentStageLabel?.trim();
  const portalDiffers = app.portalStatus && app.portalStatus !== detail;
  const stay = daysSince(app.currentStageDate, now);
  return (
    // The whole card opens the 投递 (the name's link is stretched over it);
    // the menu and meeting buttons sit above that, so a click on them
    // never races the navigation.
    <div
      className={cn(
        "group relative rounded-xl border bg-card/90 px-3 py-2.5 shadow-[0_2px_8px_-6px_rgba(0,0,0,0.25)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_8px_20px_-14px_rgba(0,0,0,0.35)]",
        closed && app.currentStage === "REJECTED" ? "border-rose-500/30" : "border-border/65 hover:border-primary/25"
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ring-1", tone.pill, tone.border)}>{app.companyName.slice(0, 1)}</span>
        <div className="min-w-0 flex-1 pr-[5.5rem]">
          <Link href={`/applications/${app.id}`} className="block truncate text-sm font-semibold leading-5 before:absolute before:inset-0 before:rounded-xl before:content-[''] group-hover:text-primary focus-visible:outline-none focus-visible:before:ring-3 focus-visible:before:ring-ring/40">
            <Highlight text={app.companyName} ranges={hit?.company} />{hit?.alias && <span className="ml-1 text-xs font-normal text-muted-foreground">（{hit.alias}）</span>}
          </Link>
          <p className="truncate text-xs text-muted-foreground" title={app.title}><Highlight text={app.title} ranges={hit?.title} />{cityHint(app.cities ?? [], app.title, app.citySource === "公司所在地") ? <span className="ml-1.5 text-muted-foreground/80">· {cityHint(app.cities ?? [], app.title, app.citySource === "公司所在地")}</span> : null}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
        <span className={cn("shrink-0 rounded-full px-1.5 py-px font-medium", tone.pill)}>{STAGE_LABELS[app.currentStage]}</span>
        {detail && <span className="min-w-0 truncate text-foreground/80" title={detail}>{detail}</span>}
        {app.portalSuggestedStage && <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-px font-medium text-amber-700 dark:text-amber-300">官网待核对</span>}
        <span className="ml-auto shrink-0" title={`投递于 ${app.appliedDate.slice(0, 10)}`}>{app.appliedDate.slice(5, 10).replace("-", "/")}</span>
        {!closed && <span className={cn("flex shrink-0 items-center gap-0.5", stay >= 14 && "font-medium text-amber-700 dark:text-amber-400")} title={`这一步已停留 ${stay} 天`}><Clock3 className="size-3" />{stay}天</span>}
      </div>
      {portalDiffers && <p className="mt-1 truncate text-xs text-muted-foreground" title={`官网显示：${app.portalStatus}`}>官网显示 · {app.portalStatus}</p>}
      {app.terminatedAtStage && <p className="mt-1 text-xs text-muted-foreground">结束于：{app.terminatedAtStageLabel || STAGE_LABELS[app.terminatedAtStage as ApplicationStage]}</p>}
      {!closed && <ProgressLine applicationId={app.id} step={app.step} next={app.nextSchedule} now={now} className="relative z-10 mt-1.5" />}
      <QuickStageMenu applicationId={app.id} companyName={app.companyName} currentStage={app.currentStage} step={app.step} className="absolute right-2 top-2 z-10 bg-card/95" />
    </div>
  );
}

function arrange(applications: BoardApplication[], narrowed: boolean) {
  const lanes = LANES.map((lane) => ({ ...lane, items: applications.filter((app) => lane.stages.includes(app.currentStage)) }))
    .filter((lane) => !narrowed || lane.items.length > 0);
  const outcomes = OUTCOMES.map((group) => ({ ...group, items: applications.filter((app) => app.currentStage === group.stage) }));
  return { lanes, outcomes };
}

function BoardBody({ applications, hits, narrowed, now }: { applications: BoardApplication[]; hits?: Map<string, ApplicationHits> | null; narrowed: boolean; now: number }) {
  const { lanes, outcomes } = arrange(applications, narrowed);
  const finished = outcomes.reduce((sum, group) => sum + group.items.length, 0);
  // Finished ones stay one click away; open by themselves when a search or filter is what brought them up.
  const [showFinished, setShowFinished] = useState(false);
  const finishedOpen = showFinished || (narrowed && lanes.length === 0);
  return <div className="space-y-4">
    {lanes.length > 0 && <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
      {lanes.map((lane) => (
        <section key={lane.title} className="min-w-0 rounded-xl border border-border/65 bg-card/35 p-2 backdrop-blur-md">
          <div className="flex items-baseline justify-between gap-2 px-1.5 pb-2 pt-1" title={lane.description}><span className="text-sm font-semibold">{lane.title}</span><span className="rounded-full bg-background/80 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{lane.items.length}</span></div>
          {/* A long column (130+ 投递 waiting on 筛选) scrolls on its own instead of stretching the page. */}
          <div className="max-h-[68vh] space-y-2 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">{lane.items.length ? lane.items.map((app) => <ApplicationCard key={app.id} app={app} hit={hits?.get(app.id)} now={now} />) : <p className="rounded-xl border border-dashed border-border/80 bg-background/35 px-3 py-6 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
        </section>
      ))}
    </div>}
    {finished > 0 && <section className="rounded-xl border border-border/70 bg-card/55 p-3 sm:p-4">
      <button type="button" onClick={() => setShowFinished(!finishedOpen)} aria-expanded={finishedOpen} className="flex w-full items-center justify-between gap-2 text-left">
        <span><span className="text-sm font-semibold">已结束的投递 · {finished}</span><span className="ml-2 text-xs text-muted-foreground">{outcomes.filter((group) => group.items.length).map((group) => `${group.title.split(" / ").pop()} ${group.items.length}`).join(" · ")}</span></span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", finishedOpen && "rotate-180")} />
      </button>
      {finishedOpen && <div className="mt-3 space-y-3">{outcomes.filter((group) => group.items.length > 0).map((group) => <div key={group.title} className="space-y-2"><h4 className={cn("text-xs font-semibold", group.className)}>{group.title} · {group.items.length}</h4><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{group.items.map((app) => <ApplicationCard key={app.id} app={app} closed hit={hits?.get(app.id)} now={now} />)}</div></div>)}</div>}
    </section>}
  </div>;
}

/**
 * `hits`: the search's matches. `narrowed`: a search or a quick filter is on,
 * so only columns with something in them are shown. `sections`: the same
 * 投递 split by company / city / week, each section its own board.
 */
export function ApplicationsBoard({ applications, sections, folded, onToggleFold, hits, narrowed = false, now, orderLabel = "" }: { applications: BoardApplication[]; sections?: Group<BoardApplication>[] | null; folded: Set<string>; onToggleFold: (key: string) => void; hits?: Map<string, ApplicationHits> | null; narrowed?: boolean; now: number; orderLabel?: string }) {
  const blocks = sections ?? [{ key: "all", label: "", items: applications }];
  // The order a 投递's page steps through: section by section, column by column, as seen here.
  const orderKey = blocks.flatMap((block) => {
    const { lanes, outcomes } = arrange(block.items, narrowed || !!sections);
    return [...lanes.flatMap((lane) => lane.items), ...outcomes.flatMap((group) => group.items)];
  }).map((app) => app.id).join(",");
  useEffect(() => {
    rememberListOrder({ ids: orderKey ? orderKey.split(",") : [], href: `${window.location.pathname}${window.location.search}`, label: orderLabel });
  }, [orderKey, orderLabel]);

  if (applications.length === 0) {
    return <div className="flex min-h-72 flex-col items-center justify-center rounded-[1.6rem] border border-dashed border-border/80 bg-card/55 px-6 py-12 text-center"><Send className="size-6 text-primary" /><h3 className="mt-5 text-base font-semibold">从第一份投递开始</h3><p className="mt-1 text-sm text-muted-foreground">添加投递记录后，这里会按阶段整理你的机会。</p></div>;
  }

  return <div className="space-y-6">
    {sections ? sections.map((section) => {
      const closed = folded.has(section.key);
      return <div key={section.key} className="space-y-3">
        <GroupHeader label={section.label} hint={section.hint} count={section.items.length} summary={groupSummary(section.items, now)} collapsed={closed} onToggle={() => onToggleFold(section.key)} />
        {!closed && <BoardBody applications={section.items} hits={hits} narrowed now={now} />}
      </div>;
    }) : <BoardBody applications={applications} hits={hits} narrowed={narrowed} now={now} />}
  </div>;
}
