"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarClock, Clock3, Send } from "lucide-react";
import type { ApplicationStage } from "@prisma/client";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { windowStatus } from "@/lib/todos";
import { applicationStageStyle } from "@/lib/application-stage-style";
import { cn } from "@/lib/utils";

export type BoardApplication = {
  id: string;
  companyName: string;
  title: string;
  currentStage: ApplicationStage;
  currentStageLabel?: string | null;
  appliedDate: string;
  currentStageDate: string;
  nextDeadline: string | null;
  nextDeadlineEnd: string | null;
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

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function ApplicationCard({ app, closed = false }: { app: BoardApplication; closed?: boolean }) {
  const tone = applicationStageStyle(app.currentStage);
  const detail = app.currentStageLabel?.trim();
  const portalDiffers = app.portalStatus && app.portalStatus !== detail;
  return (
    <Link
      href={`/applications/${app.id}`}
      className={cn(
        "group block rounded-2xl border bg-card/90 p-3.5 shadow-[0_3px_12px_-8px_rgba(0,0,0,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_25px_-14px_rgba(0,0,0,0.35)]",
        closed && app.currentStage === "REJECTED" ? "border-rose-500/30" : "border-border/65 hover:border-primary/25"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ring-1", tone.pill, tone.border)}>{app.companyName.slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1 text-sm font-semibold leading-5">
            <span className="truncate group-hover:text-primary">{app.companyName}</span>
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{app.title}</p>
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
        {!closed && <span className={cn("flex items-center gap-1", daysSince(app.currentStageDate) >= 14 && "text-amber-700 dark:text-amber-400")}><Clock3 className="size-3" />停留 {daysSince(app.currentStageDate)} 天</span>}
      </div>
      {!closed && app.nextDeadline && <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"><CalendarClock className="mt-0.5 size-3.5 shrink-0" />{windowStatus(new Date(app.nextDeadline), app.nextDeadlineEnd ? new Date(app.nextDeadlineEnd) : null).note}</p>}
    </Link>
  );
}

export function ApplicationsBoard({ applications }: { applications: BoardApplication[] }) {
  if (applications.length === 0) {
    return <div className="flex min-h-72 flex-col items-center justify-center rounded-[1.6rem] border border-dashed border-border/80 bg-card/55 px-6 py-12 text-center"><Send className="size-6 text-primary" /><h3 className="mt-5 text-base font-semibold">从第一份投递开始</h3><p className="mt-1 text-sm text-muted-foreground">添加投递记录后，这里会按阶段整理你的机会。</p></div>;
  }

  const outcomes = [
    { title: "未通过 / 公司拒绝", items: applications.filter((app) => app.currentStage === "REJECTED"), className: "text-rose-700 dark:text-rose-300" },
    { title: "已接受", items: applications.filter((app) => app.currentStage === "ACCEPTED"), className: "text-emerald-700 dark:text-emerald-300" },
    { title: "本人拒绝", items: applications.filter((app) => app.currentStage === "DECLINED"), className: "text-muted-foreground" },
  ];

  return <div className="space-y-6">
    <p className="text-xs leading-5 text-muted-foreground">这里按大类整理，不规定企业的先后顺序。点开任意投递，可以填写企业自己的阶段名称、跳过或重复某一步，也可以记录未通过。</p>
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {LANES.map((lane) => {
        const items = applications.filter((app) => lane.stages.includes(app.currentStage));
        return <section key={lane.title} className="min-w-0 rounded-[1.4rem] border border-border/65 bg-card/35 p-2.5 backdrop-blur-md">
          <div className="px-2.5 pb-3 pt-1.5"><div className="flex items-center justify-between text-sm font-semibold"><span>{lane.title}</span><span className="rounded-full bg-background/80 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{items.length}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{lane.description}</p></div>
          <div className="space-y-2.5">{items.length ? items.map((app) => <ApplicationCard key={app.id} app={app} />) : <p className="rounded-2xl border border-dashed border-border/80 bg-background/35 px-3 py-8 text-center text-xs text-muted-foreground">暂无记录</p>}</div>
        </section>;
      })}
    </div>
    {outcomes.some((group) => group.items.length > 0) && <section className="space-y-3 rounded-[1.4rem] border border-border/70 bg-card/55 p-3 sm:p-4">
      <div><h3 className="text-sm font-semibold">已结束的投递</h3><p className="mt-1 text-xs text-muted-foreground">结果不会藏起来；“未通过”与本人拒绝分开记录。</p></div>
      {outcomes.filter((group) => group.items.length > 0).map((group) => <div key={group.title} className="space-y-2"><h4 className={cn("text-xs font-semibold", group.className)}>{group.title} · {group.items.length}</h4><div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">{group.items.map((app) => <ApplicationCard key={app.id} app={app} closed />)}</div></div>)}
    </section>}
  </div>;
}
