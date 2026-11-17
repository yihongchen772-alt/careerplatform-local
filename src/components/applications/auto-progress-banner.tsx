"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Mail, Radar, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { dismissAutoStageUpdates, undoAutoStageUpdate } from "@/lib/actions/auto-progress";
import { dismissMailDraft, dismissMailSchedules, undoMailSchedule, writeMailSchedule } from "@/lib/actions/schedule";
import { absoluteWhen, clock, meetingSummary, nextActionsForMail } from "@/lib/interview-schedule";
import { MeetingActions } from "@/components/schedule/meeting-actions";
import type { MailConflictItem } from "@/lib/auto-progress";

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
  /** False for a 笔试 / 测评 deadline (a day, no clock time). */
  hasTime?: boolean;
  previousStartsAt: string | null;
  meetingInfo: string | null;
  accessCode?: string | null;
  actionRequired?: string | null;
  clashWith?: string | null;
  onStage: boolean;
  evidence: string | null;
};

type Row =
  | { kind: "conflict"; item: MailConflictItem }
  | { kind: "stage"; item: AutoProgressItem }
  | { kind: "schedule"; item: AutoScheduleItem };

/**
 * Recognised email/portal updates are already applied; this is where the
 * user sees what changed and takes back anything that was misread.
 */
export function AutoProgressBanner({
  items,
  schedules = [],
  conflicts = [],
  showApplication = true,
}: {
  items: AutoProgressItem[];
  schedules?: AutoScheduleItem[];
  conflicts?: MailConflictItem[];
  showApplication?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [handled, setHandled] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const rows: Row[] = [
    ...conflicts.map((item) => ({ kind: "conflict" as const, item })),
    ...schedules.map((item) => ({ kind: "schedule" as const, item })),
    ...items.map((item) => ({ kind: "stage" as const, item })),
  ].filter((row) => !handled.includes(row.item.id));
  const visible = rows;
  if (visible.length === 0) return null;
  // A busy inbox can produce many updates at once; keep the board in view.
  const shown = expanded ? visible : visible.slice(0, 3);
  const conflictCount = visible.filter((row) => row.kind === "conflict").length;
  const stageCount = visible.filter((row) => row.kind === "stage").length;
  const scheduleCount = visible.filter((row) => row.kind === "schedule").length;

  async function undo(item: AutoProgressItem) {
    if (busy) return;
    setBusy(item.id);
    try {
      const result = await undoAutoStageUpdate(item.id);
      if (!result.ok) return void toast.error(result.message);
      setHandled((previous) => [...previous, item.id]);
      if (item.source === "email-new") {
        toast.success(`已撤销，删掉了自动记的「${item.companyName} · ${item.title}」`);
        // On that 投递's own page there is nothing left to show.
        if (!showApplication) return void router.replace("/applications");
      } else toast.success(`已撤销，${item.companyName} 回到之前的进度`);
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
      toast.success(result.data.kept ? "已撤销。这条投递的时间你后来改过，保留你填的" : "已撤销，这封邮件回到「总览 → 我的待办」里待你核对");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function resolveConflict(item: MailConflictItem, action: "use-mail" | "keep-existing") {
    if (busy) return;
    setBusy(item.id);
    try {
      const result = action === "use-mail" ? await writeMailSchedule(item.id) : await dismissMailDraft(item.id);
      if (!result.ok) return void toast.error(result.message);
      setHandled((previous) => [...previous, item.id]);
      toast.success(action === "use-mail" ? "已改用邮件里的新时间并同步到日历" : "已保留你原定的日程时间");
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

  const summaryParts = [
    conflictCount ? `${conflictCount} 条邮件时间冲突待你确认` : "",
    stageCount ? `已自动更新 ${stageCount} 条进度` : "",
    scheduleCount ? `${stageCount ? "，" : "已"}从邮件写入 ${scheduleCount} 个面试/笔试时间` : "",
  ].filter(Boolean);

  return (
    <section className="rounded-[1.4rem] border border-primary/25 bg-primary/[0.04] p-4 sm:p-5" aria-label="自动更新的进度">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="size-4" />{summaryParts.join("；")}</div>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/settings?tab=mail#auto-progress" className="text-muted-foreground hover:text-foreground hover:underline">自动更新设置</Link>
          {(stageCount > 0 || scheduleCount > 0) && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => dismiss(visible)}>全部知道了</Button>}
        </div>
      </div>
      <div className="space-y-2">
        {shown.map((row) => {
          if (row.kind === "conflict") {
            const item = row.item;
            const end = item.mailEndsAt ? new Date(item.mailEndsAt) : null;
            return (
              <div key={`conflict-${item.id}`} className="flex flex-col gap-2 rounded-xl border border-amber-400/50 bg-amber-500/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p className="text-sm">
                      {showApplication && <><Link href={`/applications/${item.applicationId}`} className="font-medium hover:text-primary">{item.companyName} · {item.title}</Link><span className="text-muted-foreground"> · </span></>}
                      <span className="font-medium text-amber-800 dark:text-amber-300">邮件时间与手动安排不一致</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      原定：<span className="font-medium text-foreground">{absoluteWhen(item.existingStartsAt, item.existingHasTime)}</span> → 邮件：<span className="font-medium text-foreground">{item.mailHasTime ? `${absoluteWhen(item.mailStartsAt)}${end ? `–${clock(end)}` : ""}` : absoluteWhen(item.mailStartsAt, false)}</span>
                      {item.evidence ? ` · ${item.evidence}` : ""}
                    </p>
                    {item.meetingInfo && <div className="mt-1"><MeetingActions info={item.meetingInfo} compact /></div>}
                    {(() => {
                      const actions = nextActionsForMail({ text: `${item.what} ${item.evidence ?? ""}`, applicationId: item.applicationId, companyName: item.companyName });
                      return actions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {actions.map((a) => (
                            <Link key={a.href} href={a.href} className="inline-flex items-center rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">{a.label} →</Link>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => resolveConflict(item, "keep-existing")}>保留原时间</Button>
                  <Button type="button" size="sm" disabled={busy !== null} onClick={() => resolveConflict(item, "use-mail")}>{busy === item.id ? "同步中…" : "改用邮件时间"}</Button>
                </div>
              </div>
            );
          }
          if (row.kind === "schedule") {
            const item = row.item;
            const end = item.endsAt ? new Date(item.endsAt) : null;
            return (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
                      {showApplication && item.applicationId ? <><Link href={`/applications/${item.applicationId}`} className="font-medium hover:text-primary">{item.companyName} · {item.title}</Link><span className="text-muted-foreground">→</span></> : !item.applicationId ? <span className="font-medium">{item.what}</span> : null}
                      {item.applicationId && <span className="text-muted-foreground">{item.hasTime === false ? "截止" : item.previousStartsAt ? "时间改为" : "时间"}</span>}
                      {!item.applicationId && <span className="text-muted-foreground">→ 日历</span>}
                      <span className="font-medium">{item.hasTime === false ? (item.endsAt ? `${absoluteWhen(item.startsAt, false)}–${absoluteWhen(item.endsAt, false)}` : absoluteWhen(item.startsAt, false)) : `${absoluteWhen(item.startsAt)}${end ? `–${clock(end)}` : ""}`}</span>
                      {item.previousStartsAt && <span className="text-muted-foreground">（原 {absoluteWhen(item.previousStartsAt)}）</span>}
                      {item.clashWith && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="size-3" />与「{item.clashWith}」时间冲突</span>}
                      {item.actionRequired && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">待办：{item.actionRequired}</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={[item.evidence, item.meetingInfo].filter(Boolean).join("\n") || undefined}>
                      来自{item.evidence ?? "邮件"}{item.meetingInfo ? ` · ${meetingSummary(item.meetingInfo)}` : ""}
                    </p>
                    {item.meetingInfo && <div className="mt-1"><MeetingActions info={item.meetingInfo} compact /></div>}
                    {(() => {
                      const actions = nextActionsForMail({ text: `${item.what} ${item.evidence ?? ""}`, applicationId: item.applicationId, companyName: item.companyName });
                      return actions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {actions.map((a) => (
                            <Link key={a.href} href={a.href} className="inline-flex items-center rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">{a.label} →</Link>
                          ))}
                        </div>
                      );
                    })()}
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
          const fromMail = item.source === "email" || item.source === "email-new";
          const Icon = fromMail ? Mail : Radar;
          const stageActions = nextActionsForMail({ text: `${item.stageLabel ?? ""} ${item.evidence ?? ""}`, stage: item.stage, applicationId: item.applicationId, companyName: item.companyName });
          return (
            <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm">
                    {showApplication && <><Link href={`/applications/${item.applicationId}`} className="font-medium hover:text-primary">{item.companyName} · {item.title}</Link><span className="text-muted-foreground"> → </span></>}
                    {item.source === "email-new" ? <span className="font-medium">新记了一条投递</span> : <>
                      <span className="font-medium">{STAGE_LABELS[item.stage]}</span>
                      {item.stageLabel && item.stageLabel !== STAGE_LABELS[item.stage] && <span className="text-muted-foreground">（{item.stageLabel}）</span>}
                    </>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={item.evidence ?? undefined}>
                    {item.source === "email-new" ? "收到投递成功邮件，之前没记过" : fromMail ? "来自邮件" : "来自官网"}{item.evidence ? `：${item.evidence}` : ""} · {new Date(item.enteredAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  {stageActions.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {stageActions.map((a) => (
                        <Link key={a.href} href={a.href} className="inline-flex items-center rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">{a.label} →</Link>
                      ))}
                    </div>
                  )}
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
