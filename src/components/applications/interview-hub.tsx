"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarClock, CalendarPlus, FileText, ListChecks, Mail, MessageSquare, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SCHEDULE_KIND_LABELS,
  isUpcoming,
  relativeText,
  urgencyOf,
  whenText,
  type ScheduleItem,
} from "@/lib/interview-schedule";
import { setStageSchedule, writeMailSchedule } from "@/lib/actions/schedule";
import { MeetingActions } from "@/components/schedule/meeting-actions";
import { ScheduleFields, scheduleDraftFrom, scheduleFromDraft, type ScheduleDraft } from "@/components/schedule/schedule-fields";
import { useNow } from "@/components/schedule/use-now";

export type HubRow = {
  id: string;
  label: string;
  nextDeadline: string | null;
  nextDeadlineEnd: string | null;
  nextHasTime: boolean;
  meetingInfo: string | null;
  remindMinutes: number | null;
};

export type HubTask = { id: string; title: string; summary: string | null; done: boolean; createdAt: string; fromMail: boolean };

/**
 * 面试与准备 at the top of a 投递: the next time and how to get in, a way to
 * add or change that time without recording a new stage, and one click to
 * each preparation tool already set up for this job.
 */
export function InterviewHub({
  applicationId,
  companyName,
  positionId,
  closed,
  items,
  currentRow,
  rows,
  tasks,
  notesCount,
  hasQuestions,
  now: serverNow,
}: {
  applicationId: string;
  companyName: string;
  positionId: string | null;
  closed: boolean;
  items: ScheduleItem[];
  /** The current step, which 「添加面试时间」 writes to. */
  currentRow: HubRow | null;
  /** Every step, so 改时间 edits the one the shown time belongs to. */
  rows: HubRow[];
  tasks: HubTask[];
  notesCount: number;
  hasQuestions: boolean;
  now: number;
}) {
  const router = useRouter();
  const now = useNow(serverNow);
  const upcoming = items.filter((item) => isUpcoming(item, now, 3650));
  // Nothing ahead: the current step's past time or deadline still says
  // something (「已过 2 天」 — time to update the progress).
  const next = upcoming[0] ?? items.filter((item) => item.source === "stage").at(-1) ?? null;
  const later = upcoming.slice(1, 4);
  // What 改时间 edits: the step behind the shown time, else the current step.
  const editable = (next?.source === "stage" ? rows.find((row) => row.id === next.sourceId) : null) ?? currentRow;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>(() => (editable ? scheduleDraftFrom(editable) : scheduleDraftFrom({ nextDeadline: null, nextDeadlineEnd: null })));
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState<string | null>(null);

  function startEditing() {
    if (!editable) return;
    setDraft(scheduleDraftFrom(editable));
    setEditing(true);
  }

  async function save() {
    if (!editable) return;
    const parsed = scheduleFromDraft(draft);
    if ("error" in parsed) return void toast.error(parsed.error);
    setSaving(true);
    try {
      const result = await setStageSchedule(editable.id, parsed.value);
      if (!result.ok) return void toast.error(result.message);
      toast.success(parsed.value.nextHasTime ? "已保存，到点前会提醒你" : parsed.value.nextDeadline ? "已保存截止日期" : "已清除时间安排");
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function write(item: ScheduleItem) {
    if (writing) return;
    setWriting(item.key);
    try {
      const result = await writeMailSchedule(item.sourceId);
      if (!result.ok) return void toast.error(result.message);
      toast.success("已写入这条投递的进度和日历");
      router.refresh();
    } finally {
      setWriting(null);
    }
  }

  const urgency = next ? urgencyOf(next, now) : null;
  const tools = [
    { href: `/mock-interview?application=${encodeURIComponent(applicationId)}`, label: "AI 模拟面试", hint: "已选好这个岗位，直接开始", icon: MessageSquare },
    { href: "#interview-qa", label: "面试题预测", hint: hasQuestions ? "已生成，点开复习" : "按简历和岗位生成题目与思路", icon: ListChecks },
    { href: `/interviews?company=${encodeURIComponent(companyName)}`, label: `${companyName} 面经`, hint: notesCount ? `你记录过 ${notesCount} 条` : "还没有记录，面完可在时间线写复盘", icon: BookOpen },
    positionId
      ? { href: `/pool?position=${encodeURIComponent(positionId)}&prep=1&from=${encodeURIComponent(applicationId)}`, label: "岗位 JD / 面试攻略", hint: "候选池里的岗位要求和准备攻略", icon: FileText }
      : null,
  ].filter((tool): tool is NonNullable<typeof tool> => !!tool);

  return (
    <section id="interview" aria-label="面试与准备" className="scroll-mt-20 rounded-[1.6rem] border border-border/65 bg-card/75 p-4 shadow-[0_16px_45px_-38px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><CalendarClock className="size-4 text-primary" />面试与准备</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">下一场的时间和会议入口、准备工具都在这里。</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className={cn("rounded-2xl border p-4", urgency === "now" ? "border-emerald-500/40 bg-emerald-500/[0.05]" : urgency === "today" ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border/60 bg-background/45")}>
          {editing && editable ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">{editable.nextDeadline ? "修改时间安排" : "添加面试 / 笔试时间"} <span className="font-normal text-muted-foreground">· {editable.label}</span></p>
              <ScheduleFields value={draft} onChange={setDraft} idPrefix="hub-schedule" autoFocusDate />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存"}</Button>
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>取消</Button>
                {editable.nextDeadline && (
                  <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={saving} onClick={() => setDraft({ ...draft, date: "", time: "", endTime: "", endDate: "" })}>清除时间</Button>
                )}
              </div>
            </div>
          ) : next ? (
            <div>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{next.source === "mail" ? "邮件识别" : SCHEDULE_KIND_LABELS[next.kind]}</span>
                {[next.title !== SCHEDULE_KIND_LABELS[next.kind] ? next.title : "", next.interviewFormat].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{whenText(next, now)}</p>
              <p className={cn("mt-1 text-sm", urgency === "now" ? "font-semibold text-emerald-700 dark:text-emerald-300" : urgency === "today" ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{relativeText(next, now)}</p>
              {next.meetingInfo && <p className="mt-3 break-all text-sm text-foreground/85">{next.meetingInfo}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MeetingActions info={next.meetingInfo} />
                {next.source === "mail" ? (
                  <Button size="sm" className="h-7 rounded-full px-2.5 text-xs" disabled={writing !== null} onClick={() => write(next)}>{writing === next.key ? "写入中…" : "写入日程"}</Button>
                ) : (
                  !closed && editable && <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={startEditing}><Pencil className="size-3.5" />改时间 / 会议信息</Button>
                )}
              </div>
              {next.source === "mail" && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{next.conflictsWith ? "这是邮件里识别到的时间，和你记录的不同；确认后点「写入日程」替换。" : "这是邮件里识别到的时间，还没写入；确认无误点「写入日程」。"}</p>}
              {next.source === "stage" && next.hasTime && next.remindMinutes !== null && next.remindMinutes !== undefined && urgency !== "past" && (
                <p className="mt-2 text-[11px] text-muted-foreground">{next.remindMinutes === 0 ? "开始时" : next.remindMinutes >= 1440 ? `提前 ${next.remindMinutes / 1440} 天` : next.remindMinutes >= 60 ? `提前 ${next.remindMinutes / 60} 小时` : `提前 ${next.remindMinutes} 分钟`}弹系统提醒 · 已在日历中</p>
              )}
              {later.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                  {later.map((item) => <li key={item.key}>之后：{item.title} · {whenText(item, now)}{item.source === "mail" ? "（邮件识别，未写入）" : ""}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-start justify-center gap-2">
              <p className="text-sm font-medium">{closed ? "这条投递已结束" : "还没有面试 / 笔试时间"}</p>
              <p className="text-xs text-muted-foreground">{closed ? "没有后续安排。" : "收到邀请后把时间和会议链接记在这里：倒计时、一键进会议，开始前弹系统提醒。"}</p>
              {!closed && currentRow && <Button size="sm" className="mt-1 gap-1" onClick={startEditing}><CalendarPlus className="size-4" />添加面试时间</Button>}
            </div>
          )}
        </div>
        <div className="grid content-start gap-2 sm:grid-cols-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const body = (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary"><Icon className="size-4" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{tool.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{tool.hint}</span>
                </span>
              </>
            );
            const className = "flex items-center gap-2.5 rounded-xl border border-border/60 bg-background/45 p-3 transition-colors hover:border-primary/30 hover:bg-primary/[0.04]";
            return tool.href.startsWith("#")
              ? <a key={tool.label} href={tool.href} className={className}>{body}</a>
              : <Link key={tool.label} href={tool.href} className={className}>{body}</Link>;
          })}
        </div>
      </div>
      {tasks.length > 0 && (
        <details className="mt-4 rounded-xl border border-border/50 bg-background/35 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground"><Mail className="mr-1 inline size-3.5 align-[-2px]" />相关邮件和待办（{tasks.length}）</summary>
          <ul className="mt-2 space-y-1.5">
            {tasks.map((task) => (
              <li key={task.id} className="text-xs">
                <span className={cn("font-medium", task.done && "text-muted-foreground line-through")}>{task.title}</span>
                <span className="text-muted-foreground"> · {new Date(task.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>
                {task.summary && <p className="text-muted-foreground">{task.summary}</p>}
              </li>
            ))}
          </ul>
          <Link href="/dashboard" className="mt-2 inline-block text-[11px] text-primary hover:underline">在「总览 → 我的日程」里处理</Link>
        </details>
      )}
    </section>
  );
}
