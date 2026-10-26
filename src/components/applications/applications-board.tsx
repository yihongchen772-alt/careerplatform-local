"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, Send } from "lucide-react";
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
  { title: "测评与笔试", description: "可跳过，也可能在面试后", stages: ["ASSESSMENT", "OA"] },
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
        "group relative rounded-2xl border bg-card/90 p-3.5 shadow-[0_3px_12px_-8px_rgba(0,0,0,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_25px_-14px_rgba(0,0,0,0.35)]",
        closed && app.currentStage === "REJECTED" ? "border-rose-500/30" : "border-border/65 hover:border-primary/25"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ring-1", tone.pill, tone.border)}>{app.companyName.slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <div className="pr-20 text-sm font-semibold leading-5">
            <Link href={`/applications/${app.id}`} className="block truncate before:absolute before:inset-0 before:rounded-2xl before:content-[''] group-hover:text-primary focus-visible:outline-none focus-visible:before:ring-3 focus-visible:before:ring-ring/40">
              <Highlight text={app.companyName} ranges={hit?.company} />{hit?.alias && <span className="ml-1 text-xs font-normal text-muted-foreground">（{hit.alias}）</span>}
            </Link>
          </div>
          <p className="mt-0.5 truncate pr-20 text-xs text-muted-foreground"><Highlight text={app.title} ranges={hit?.title} />{cityHint(app.cities ?? [], app.title) ? <span className="ml-1.5 text-muted-foreground/80">· {cityHint(app.cities ?? [], app.title)}</span> : null}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5 text-[11px]">
        <span className={cn("rounded-full px-2 py-0.5 font-medium", tone.pill)}>{STAGE_LABELS[app.currentStage]}</span>
        {detail && <span className="max-w-full truncate text-foreground/85" title={detail}>{detail}</span>}
        {app.portalSuggestedStage && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">官网结果待核对</span>}
      </div>
      {portalDiffers && <p className="mt-2 truncate text-[11px] text-muted-foreground" title={`官网显示：${app.portalStatus}`}>官网显示 · {app.portalStatus}</p>}
      <div className="mt-2.5 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>投递 {app.appliedDate.slice(5, 10).replace("-", "/")}</span>
        {!closed && <span className={cn("flex items-center gap-1", stay >= 14 && "text-amber-700 dark:text-amber-400")}><Clock3 className="size-3" />停留 {stay} 天</span>}
      </div>
      {app.terminatedAtStage && <p className="mt-2 text-xs text-muted-foreground">结束于：{app.terminatedAtStageLabel || STAGE_LABELS[app.terminatedAtStage as ApplicationStage]}</p>}
      {!closed && <ProgressLine applicationId={app.id} step={app.step} next={app.nextSchedule} now={now} className="relative z-10 mt-2" />}
      <QuickStageMenu applicationId={app.id} companyName={app.companyName} currentStage={app.currentStage} step={app.step} className="absolute right-3 top-3 z-10 bg-card/95" />
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
  return <div className="space-y-6">
    {lanes.length > 0 && <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {lanes.map((lane) => (
        <section key={lane.title} className="min-w-0 rounded-xl border border-border/65 bg-card/35 p-2.5 backdrop-blur-md">
          <div className="px-2.5 pb-3 pt-1.5"><div className="flex items-center justify-between text-sm font-semibold"><span>{lane.title}</span><span className="rounded-full bg-background/80 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{lane.items.length}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{lane.description}</p></div>
          <div className="space-y-2.5">{lane.items.length ? lane.items.map((app) => <ApplicationCard key={app.id} app={app} hit={hits?.get(app.id)} now={now} />) : <p className="rounded-2xl border border-dashed border-border/80 bg-background/35 px-3 py-8 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
        </section>
      ))}
    </div>}
    {outcomes.some((group) => group.items.length > 0) && <section className="space-y-3 rounded-xl border border-border/70 bg-card/55 p-3 sm:p-4">
      <div><h3 className="text-sm font-semibold">已结束的投递</h3><p className="mt-1 text-xs text-muted-foreground">结果不会藏起来；“未通过”与本人拒绝分开记录。</p></div>
      {outcomes.filter((group) => group.items.length > 0).map((group) => <div key={group.title} className="space-y-2"><h4 className={cn("text-xs font-semibold", group.className)}>{group.title} · {group.items.length}</h4><div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">{group.items.map((app) => <ApplicationCard key={app.id} app={app} closed hit={hits?.get(app.id)} now={now} />)}</div></div>)}
    </section>}
  </div>;
}

/**
 * `hits`: the search's matches. `narrowed`: a search or a quick filter is on,
 * so only columns with something in them are shown. `sections`: the same
 * 投递 split by company / city / week, each section its own board.
 */
export function ApplicationsBoard({ applications, sections, hits, narrowed = false, now, orderLabel = "" }: { applications: BoardApplication[]; sections?: Group<BoardApplication>[] | null; hits?: Map<string, ApplicationHits> | null; narrowed?: boolean; now: number; orderLabel?: string }) {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
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
    <p className="text-xs leading-5 text-muted-foreground">这里按大类整理，不规定企业的先后顺序。卡片右上角「改进度」一键切换阶段；有面试时间的卡片会显示倒计时和「进入会议」。</p>
    {sections ? sections.map((section) => {
      const closed = folded.has(section.key);
      return <div key={section.key} className="space-y-3">
        <GroupHeader label={section.label} hint={section.hint} count={section.items.length} summary={groupSummary(section.items, now)} collapsed={closed} onToggle={() => setFolded((previous) => { const next = new Set(previous); if (!next.delete(section.key)) next.add(section.key); return next; })} />
        {!closed && <BoardBody applications={section.items} hits={hits} narrowed now={now} />}
      </div>;
    }) : <BoardBody applications={applications} hits={hits} narrowed={narrowed} now={now} />}
  </div>;
}
