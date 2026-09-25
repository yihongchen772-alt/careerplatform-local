"use client";

import { useState } from "react";
import { BriefcaseBusiness, CircleX, LayoutGrid, List, MessagesSquare, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ApplicationsTable,
  type ApplicationRow,
} from "@/components/applications/applications-table";
import { ApplicationsBoard } from "@/components/applications/applications-board";
import { PortalReviewBanner } from "@/components/applications/portal-review-banner";

/**
 * Board and table over the same data. The board answers "where am I stuck",
 * the table answers "what did I apply to and when" — both are worth having,
 * and neither replaces the other, so this is a toggle rather than a
 * migration away from the table.
 */
export function ApplicationsView({ applications }: { applications: ApplicationRow[] }) {
  const [view, setView] = useState<"board" | "table">("board");
  const active = applications.filter((a) => !["REJECTED", "ACCEPTED", "DECLINED"].includes(a.currentStage)).length;
  const interviews = applications.filter((a) => a.currentStage.startsWith("INTERVIEW") || a.currentStage === "HR_INTERVIEW").length;
  const offers = applications.filter((a) => a.currentStage === "OFFER" || a.currentStage === "ACCEPTED").length;
  const rejected = applications.filter((a) => a.currentStage === "REJECTED").length;
  const metrics = [
    { label: "累计投递", value: applications.length, icon: BriefcaseBusiness, caption: "所有投递记录" },
    { label: "进行中", value: active, icon: Sparkles, caption: "仍在推进的机会" },
    { label: "面试阶段", value: interviews, icon: MessagesSquare, caption: "值得重点准备" },
    { label: "未通过", value: rejected, icon: CircleX, caption: offers > 0 ? `另有 ${offers} 个 Offer / 已接受` : "公司结束的流程" },
  ];

  return (
    <div className="space-y-6">
      <PortalReviewBanner items={applications.filter((a) => a.portalSuggestedStage).map((a) => ({
        id: a.id,
        companyName: a.company.name,
        title: a.title,
        currentStage: a.currentStage,
        suggestedStage: a.portalSuggestedStage!,
        portalStatus: a.portalStatus ?? null,
      }))} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="relative overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/75 p-4 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
                <span className="flex size-8 items-center justify-center rounded-xl bg-primary/8 text-primary"><Icon className="size-4" /></span>
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-[-0.055em] tabular-nums sm:text-4xl">{metric.value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{metric.caption}</p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">进度视图</h2>
          <p className="mt-1 text-xs text-muted-foreground">把每次投递放在它当前所处的位置，下一步一眼可见。</p>
        </div>
        <div className="inline-flex w-fit gap-1 rounded-full border border-border/70 bg-card/75 p-1 shadow-sm backdrop-blur-xl" aria-label="投递记录视图">
          {([
            { id: "board" as const, label: "看板", icon: LayoutGrid },
            { id: "table" as const, label: "列表", icon: List },
          ]).map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-all duration-200",
                  view === option.id ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === "board" ? (
        <ApplicationsBoard
          applications={applications.map((a) => ({
            id: a.id,
            companyName: a.company.name,
            title: a.title,
            currentStage: a.currentStage,
            currentStageLabel: a.currentStageLabel,
            appliedDate: a.appliedDate,
            currentStageDate: a.currentStageDate,
            nextDeadline: a.nextDeadline,
            nextDeadlineEnd: a.nextDeadlineEnd,
            portalStatus: a.portalStatus,
            portalSuggestedStage: a.portalSuggestedStage,
          }))}
        />
      ) : (
        <Card className="border-0 bg-card/80">
          <CardContent className="pt-1">
            <ApplicationsTable applications={applications} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
