"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Mail, Radar, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { dismissAutoStageUpdates, undoAutoStageUpdate } from "@/lib/actions/auto-progress";
import { dismissMailSchedules, undoMailSchedule } from "@/lib/actions/schedule";
import { absoluteWhen, clock } from "@/lib/interview-schedule";

export type AutoProgressItem = {
  id: string;
  applicationId: string;
  companyName: string;
  title: string;
  stage: ApplicationStage;
  stageLabel: string | null;
  source: string;
  evidence: string | null;
  enteredAt: string;
};

/** An interview / 笔试 time recognised in mail and written by itself. */
export type AutoScheduleItem = {
  id: string;
  applicationId: string | null;
  companyName: string | null;
  title: string | null;
  what: string;
  startsAt: string;
  endsAt: string | null;
  previousStartsAt: string | null;
  meetingInfo: string | null;
  onStage: boolean;
  evidence: string | null;
};

type Row = { kind: "stage"; item: AutoProgressItem } | { kind: "schedule"; item: AutoScheduleItem };

/**
 * Recognised email/portal updates are already applied; this is where the
 * user sees what changed and takes back anything that was misread.
 */
export function AutoProgressBanner({ items, schedules = [], showApplication = true }: { items: AutoProgressItem[]; schedules?: AutoScheduleItem[]; showApplication?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [handled, setHandled] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const rows: Row[] = [
    ...schedules.map((item) => ({ kind: "schedule" as const, item })),
    ...items.map((item) => ({ kind: "stage" as const, item })),
  ].filter((row) => !handled.includes(row.item.id));
  const visible = rows;
  if (visible.length === 0) return null;
  // A busy inbox can produce many updates at once; keep the board in view.
  const shown = expanded ? visible : visible.slice(0, 3);
  const stageCount = visible.filter((row) => row.kind === "stage").length;
  const scheduleCount = visible.length - stageCount;

  async function undo(item: AutoProgressItem) {
    if (busy) return;
    setBusy(item.id);
    try {
      const result = await undoAutoStageUpdate(item.id);
      if (!result.ok) return void toast.error(result.message);
      setHandled((previous) => [...previous, item.id]);
      toast.success(`已撤销，${item.companyName} 回到之前的进度`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function undoSchedule(item: AutoScheduleItem) {
    if (busy) return;
    setBusy(item.id);
    try {
      const result = await undoMailSchedule(item.id);
      if (!result.ok) return void toast.error(result.message);
      setHandled((previous) => [...previous, item.id]);
      toast.success(result.data.kept ? "已撤销。这条投递的时间你后来改过，保留你填的" : "已撤销，这封邮件回到「总览 → 我的日程」里待你核对");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(dismissed: Row[]) {
    if (busy) return;
    setBusy("all");
    try {
      const stageIds = dismissed.filter((row) => row.kind === "stage").map((row) => row.item.id);
      const scheduleIds = dismissed.filter((row) => row.kind === "schedule").map((row) => row.item.id);
      const results = await Promise.all([
        stageIds.length ? dismissAutoStageUpdates(stageIds) : null,
        scheduleIds.length ? dismissMailSchedules(scheduleIds) : null,
      ]);
      const failed = results.find((result) => result && !result.ok);
      if (failed && !failed.ok) return void toast.error(failed.message);
      setHandled((previous) => [...previous, ...stageIds, ...scheduleIds]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[1.4rem] border border-primary/25 bg-primary/[0.04] p-4 sm:p-5" aria-label="自动更新的进度">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="size-4" />{[stageCount ? `已自动更新 ${stageCount} 条进度` : "", scheduleCount ? `${stageCount ? "，" : "已"}从邮件写入 ${scheduleCount} 个面试/笔试时间` : ""].join("")}</div>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/settings#auto-progress" className="text-muted-foreground hover:text-foreground hover:underline">自动更新设置</Link>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => dismiss(visible)}>全部知道了</Button>
        </div>
      </div>
      <div className="space-y-2">
        {shown.map((row) => {
          if (row.kind === "schedule") {
            const item = row.item;
            const end = item.endsAt ? new Date(item.endsAt) : null;
            return (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm">
                      {showApplication && item.applicationId ? <><Link href={`/applications/${item.applicationId}`} className="font-medium hover:text-primary">{item.companyName} · {item.title}</Link><span className="text-muted-foreground"> → </span></> : !item.applicationId ? <span className="font-medium">{item.what}</span> : null}
                      {item.applicationId && <span className="text-muted-foreground">{item.previousStartsAt ? "时间改为 " : "时间 "}</span>}
                      {!item.applicationId && <span className="text-muted-foreground"> → 日历 </span>}
                      <span className="font-medium">{absoluteWhen(item.startsAt)}{end ? `–${clock(end)}` : ""}</span>
                      {item.previousStartsAt && <span className="text-muted-foreground">（原 {absoluteWhen(item.previousStartsAt)}）</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={[item.evidence, item.meetingInfo].filter(Boolean).join("\n") || undefined}>
                      来自{item.evidence ?? "邮件"}{item.meetingInfo ? ` · ${item.meetingInfo}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => dismiss([row])}>没问题</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => undoSchedule(item)}>{busy === item.id ? "撤销中…" : "撤销"}</Button>
                </div>
              </div>
            );
          }
          const item = row.item;
          const Icon = item.source === "email" ? Mail : Radar;
          return (
            <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm">
                    {showApplication && <><Link href={`/applications/${item.applicationId}`} className="font-medium hover:text-primary">{item.companyName} · {item.title}</Link><span className="text-muted-foreground"> → </span></>}
                    <span className="font-medium">{STAGE_LABELS[item.stage]}</span>
                    {item.stageLabel && item.stageLabel !== STAGE_LABELS[item.stage] && <span className="text-muted-foreground">（{item.stageLabel}）</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={item.evidence ?? undefined}>
                    {item.source === "email" ? "来自邮件" : "来自官网"}{item.evidence ? `：${item.evidence}` : ""} · {new Date(item.enteredAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => dismiss([row])}>没问题</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => undo(item)}>{busy === item.id ? "撤销中…" : "撤销"}</Button>
              </div>
            </div>
          );
        })}
      </div>
      {visible.length > shown.length && <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => setExpanded(true)}>还有 {visible.length - shown.length} 条，展开</button>}
    </section>
  );
}
