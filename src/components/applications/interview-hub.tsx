"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ApplicationStage } from "@prisma/client";
import { BookOpen, CalendarClock, CalendarPlus, CheckCircle2, ChevronDown, Copy, FileText, Hourglass, ListChecks, Mail, MessageSquare, NotebookPen, Pencil, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/stage-labels";
import {
  SCHEDULE_KIND_LABELS,
  defaultScheduleStage,
  isUpcoming,
  relativeText,
  scheduleKindOf,
  scheduleStageChoices,
  urgencyOf,
  whenText,
  type ScheduleItem,
  type StepView,
} from "@/lib/interview-schedule";
import { addStageSchedule, markFollowedUp, saveStepNote, setStageSchedule, writeMailSchedule } from "@/lib/actions/schedule";
import { addStageUpdate, deleteStageHistory } from "@/lib/actions/applications";
import { generateStagePostmortem, type StagePostmortem } from "@/lib/actions/stage-postmortem";
import { communicationDraft } from "@/lib/application-workflow";
import { MeetingActions } from "@/components/schedule/meeting-actions";
import { ScheduleFields, scheduleDraftFrom, scheduleFromDraft, type ScheduleDraft } from "@/components/schedule/schedule-fields";
import { completeStep } from "@/components/schedule/step-actions";
import { useNow } from "@/components/schedule/use-now";

export type HubRow = {
  id: string;
  stage: ApplicationStage;
  label: string;
  nextDeadline: string | null;
  nextDeadlineEnd: string | null;
  nextHasTime: boolean;
  meetingInfo: string | null;
  remindMinutes: number | null;
  note: string | null;
};

export type HubTask = { id: string; title: string; summary: string | null; done: boolean; createdAt: string; fromMail: boolean };

const AFTER: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER"];

/**
 * 面试与准备 at the top of a 投递: the next time and how to get in, adding a
 * time for whichever round it is for, the 面完了 step afterwards (notes
 * while fresh, the result in one click, a nudge to follow up), and one click
 * to each preparation tool already set up for this job.
 */
export function InterviewHub({
  applicationId,
  companyName,
  jobTitle,
  positionId,
  currentStage,
  closed,
  items,
  currentRow,
  rows,
  step,
  tasks,
  notesCount,
  hasQuestions,
  hasBrief,
  autoAdd,
  now: serverNow,
}: {
  applicationId: string;
  companyName: string;
  jobTitle: string;
  positionId: string | null;
  currentStage: ApplicationStage;
  closed: boolean;
  items: ScheduleItem[];
  /** The current step. */
  currentRow: HubRow | null;
  /** Every step, so 改时间 edits the one the shown time belongs to. */
  rows: HubRow[];
  /** 等结果 / 截止已过 / still to do, for the current round. */
  step: StepView | null;
  tasks: HubTask[];
  notesCount: number;
  hasQuestions: boolean;
  hasBrief: boolean;
  /** Opened from 「加时间」: start in the add form. */
  autoAdd: boolean;
  now: number;
}) {
  const router = useRouter();
  const now = useNow(serverNow);
  const upcoming = items.filter((item) => isUpcoming(item, now, 3650));
  // Nothing ahead: the current step's past time or deadline still says
  // something (「已过 2 天」 — time to update the progress).
  const waiting = step?.phase === "waiting";
  const next = upcoming[0] ?? (waiting ? null : items.filter((item) => item.source === "stage").at(-1) ?? null);
  const later = upcoming.slice(next === upcoming[0] ? 1 : 0, 4);
  const editTarget = (next?.source === "stage" ? rows.find((row) => row.id === next.sourceId) : null) ?? null;
  const choices = scheduleStageChoices(currentStage);
  const [mode, setMode] = useState<"view" | "add" | "edit">(autoAdd && !closed ? "add" : "view");
  const [round, setRound] = useState<ApplicationStage>(defaultScheduleStage(currentStage));
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftFrom({ nextDeadline: null, nextDeadlineEnd: null }));
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState<string | null>(null);

  function startAdd() {
    setRound(defaultScheduleStage(currentStage));
    setDraft(scheduleDraftFrom({ nextDeadline: null, nextDeadlineEnd: null }));
    setMode("add");
  }

  function startEdit() {
    if (!editTarget) return;
    setDraft(scheduleDraftFrom(editTarget));
    setMode("edit");
  }

  async function save() {
    const parsed = scheduleFromDraft(draft);
    if ("error" in parsed) return void toast.error(parsed.error);
    if (mode === "add" && !parsed.value.nextDeadline) return void toast.error("请先选日期");
    setSaving(true);
    try {
      if (mode === "edit" && editTarget) {
        const result = await setStageSchedule(editTarget.id, parsed.value);
        if (!result.ok) return void toast.error(result.message);
        toast.success(parsed.value.nextHasTime ? "已保存，到点前会提醒你" : parsed.value.nextDeadline ? "已保存截止日期" : "已清除时间安排");
      } else {
        const result = await addStageSchedule(applicationId, round, parsed.value);
        if (!result.ok) return void toast.error(result.message);
        const { stageHistoryId, created } = result.data;
        toast.success(created ? `已推进到「${STAGE_LABELS[round]}」，${parsed.value.nextHasTime ? "时间已进日历" : "截止日期已记上"}` : parsed.value.nextHasTime ? "已保存，到点前会提醒你" : "已保存截止日期", created ? {
          action: {
            label: "撤销",
            onClick: async () => {
              const undo = await deleteStageHistory(stageHistoryId);
              if (!undo.ok) toast.error(undo.message);
              else router.refresh();
            },
          },
        } : undefined);
      }
      setMode("view");
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
    { href: `/applications/${encodeURIComponent(applicationId)}/brief`, label: "面试速览", hint: hasBrief ? "一页看完要点，面试前过一遍" : "JD 要点、经历、预测题、反问，一页汇总", icon: NotebookPen },
    { href: `/mock-interview?application=${encodeURIComponent(applicationId)}`, label: "AI 模拟面试", hint: "已选好这个岗位，直接开始", icon: MessageSquare },
    { href: "#interview-qa", label: "面试题预测", hint: hasQuestions ? "已生成，点开复习" : "按简历和岗位生成题目与思路", icon: ListChecks },
    { href: `/interviews?company=${encodeURIComponent(companyName)}`, label: `${companyName} 面经`, hint: notesCount ? `你记录过 ${notesCount} 条` : "还没有记录，面完可在这里记两句", icon: BookOpen },
    positionId
      ? { href: `/pool?position=${encodeURIComponent(positionId)}&prep=1&from=${encodeURIComponent(applicationId)}`, label: "岗位 JD / 面试攻略", hint: "候选池里的岗位要求和准备攻略", icon: FileText }
      : null,
  ].filter((tool): tool is NonNullable<typeof tool> => !!tool);

  return (
    <section id="interview" aria-label="面试与准备" className="scroll-mt-20 rounded-[1.6rem] border border-border/65 bg-card/75 p-4 shadow-[0_16px_45px_-38px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><CalendarClock className="size-4 text-primary" />面试与准备</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">下一场的时间和会议入口、面完后的记录和结果、准备工具都在这里。</p>
        </div>
        {!closed && mode === "view" && (next || waiting) && (
          <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs" onClick={startAdd}><Plus className="size-3.5" />添加安排</Button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className={cn("rounded-2xl border p-4", mode === "view" && urgency === "now" ? "border-emerald-500/40 bg-emerald-500/[0.05]" : mode === "view" && urgency === "today" ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border/60 bg-background/45")}>
          {mode !== "view" ? (
            <div className="space-y-3">
              {mode === "add" ? (
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <label htmlFor="hub-round">添加安排：这是</label>
                  <select
                    id="hub-round"
                    value={round}
                    onChange={(event) => setRound(event.target.value as ApplicationStage)}
                    className="h-8 rounded-xl border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  >
                    {choices.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}{stage === currentStage ? "（当前）" : ""}</option>)}
                  </select>
                  {round !== currentStage && <span className="text-xs font-normal text-muted-foreground">保存后进度推进到「{STAGE_LABELS[round]}」</span>}
                </div>
              ) : (
                <p className="text-sm font-medium">修改时间安排 <span className="font-normal text-muted-foreground">· {editTarget?.label}</span></p>
              )}
              <ScheduleFields value={draft} onChange={setDraft} idPrefix="hub-schedule" autoFocusDate excludeRowId={mode === "edit" ? editTarget?.id ?? null : null} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存"}</Button>
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => setMode("view")}>取消</Button>
                {mode === "edit" && editTarget?.nextDeadline && (
                  <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={saving} onClick={() => setDraft({ ...draft, date: "", time: "", endTime: "", endDate: "" })}>清除时间</Button>
                )}
              </div>
            </div>
          ) : waiting && step && currentRow ? (
            <AfterStep
              applicationId={applicationId}
              companyName={companyName}
              jobTitle={jobTitle}
              currentStage={currentStage}
              step={step}
              row={currentRow}
            />
          ) : next ? (
            <div>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{next.source === "mail" ? "邮件识别" : SCHEDULE_KIND_LABELS[next.kind]}</span>
                {[next.title !== SCHEDULE_KIND_LABELS[next.kind] ? next.title : "", next.interviewFormat].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{whenText(next, now)}</p>
              <p className={cn("mt-1 text-sm", urgency === "now" ? "font-semibold text-emerald-700 dark:text-emerald-300" : urgency === "today" ? "font-medium text-amber-700 dark:text-amber-300" : urgency === "past" && !next.hasTime ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                {relativeText(next, now)}{step?.phase === "due" ? " · 做完了吗？" : ""}
              </p>
              {next.meetingInfo && <p className="mt-3 break-all text-sm text-foreground/85">{next.meetingInfo}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MeetingActions info={next.meetingInfo} />
                {next.source === "mail" ? (
                  <Button size="sm" className="h-7 rounded-full px-2.5 text-xs" disabled={writing !== null} onClick={() => write(next)}>{writing === next.key ? "写入中…" : "写入日程"}</Button>
                ) : (
                  !closed && editTarget && <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={startEdit}><Pencil className="size-3.5" />改时间 / 会议信息</Button>
                )}
                {!closed && step && step.phase !== "waiting" && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs" onClick={() => completeStep(step.rowId, () => router.refresh())}>
                    <CheckCircle2 className="size-3.5" />{scheduleKindOf(step.stage) === "interview" ? "我已面完" : "我已完成"}
                  </Button>
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
              {!closed && (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1" onClick={startAdd}><CalendarPlus className="size-4" />添加面试时间</Button>
                  {step && step.phase === "open" && (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => completeStep(step.rowId, () => router.refresh())}>
                      <CheckCircle2 className="size-4" />{scheduleKindOf(step.stage) === "interview" ? "我已面完" : "我已完成"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          {mode === "view" && waiting && upcoming.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
              {upcoming.slice(0, 3).map((item) => <li key={item.key}>接下来：{item.title} · {whenText(item, now)}</li>)}
            </ul>
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

/**
 * 面完了: write a few lines while it is fresh (they go to 面经库, and AI 复盘
 * works from them), record the result in one click, and — after a week of
 * silence — a ready follow-up mail.
 */
function AfterStep({ applicationId, companyName, jobTitle, currentStage, step, row }: { applicationId: string; companyName: string; jobTitle: string; currentStage: ApplicationStage; step: StepView; row: HubRow }) {
  const router = useRouter();
  const [note, setNote] = useState(row.note ?? "");
  const [savedNote, setSavedNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<StagePostmortem | null>(null);
  const interview = scheduleKindOf(step.stage) === "interview";
  const nextRounds = AFTER.filter((stage) => AFTER.indexOf(stage) > AFTER.indexOf(currentStage) || !AFTER.includes(currentStage));

  async function saveNote(): Promise<boolean> {
    setBusy("note");
    try {
      const result = await saveStepNote(row.id, note);
      if (!result.ok) {
        toast.error(result.message);
        return false;
      }
      setSavedNote(note);
      toast.success(note.trim() ? "已记下，面经库里也能看到" : "已清空");
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function runReview() {
    if (note !== savedNote && !(await saveNote())) return;
    setBusy("review");
    try {
      const result = await generateStagePostmortem(row.id);
      if (!result.ok) return void toast.error(result.message);
      setReview(result.data);
    } finally {
      setBusy(null);
    }
  }

  async function moveTo(stage: ApplicationStage) {
    setBusy("result");
    try {
      const { stageHistoryId } = await addStageUpdate(applicationId, { stage });
      const bookable = stage !== "REJECTED";
      toast.success(stage === "REJECTED" ? `已记录${companyName}未通过` : `已推进到「${STAGE_LABELS[stage]}」`, {
        action: { label: "撤销", onClick: async () => { const undo = await deleteStageHistory(stageHistoryId); if (!undo.ok) toast.error(undo.message); else router.refresh(); } },
        ...(bookable ? { cancel: { label: "加时间", onClick: () => router.push(`/applications/${applicationId}?addTime=1#interview`) } } : {}),
      });
      router.refresh();
    } catch {
      toast.error("更新失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className={cn("flex items-center gap-2 text-sm font-semibold", step.followUp && "text-amber-700 dark:text-amber-300")}>
        {step.followUp ? <Hourglass className="size-4" /> : <CheckCircle2 className="size-4 text-emerald-600" />}
        {row.label} {step.text}
      </p>
      <div className="space-y-1.5">
        <label htmlFor="after-note" className="text-xs font-medium text-muted-foreground">{interview ? "趁记得记两句：问了什么、哪里没答好（会进面经库）" : "记两句：题型、难度、没做出来的题（会进面经库）"}</label>
        <Textarea id="after-note" rows={3} value={note} maxLength={20000} onChange={(event) => setNote(event.target.value)} placeholder={interview ? "例如：自我介绍后深挖了实习项目的指标设计；问了 Redis 持久化；反问了团队规模" : "例如：行测 60 题时间很紧；性格测试 200 题"} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null || note === savedNote} onClick={saveNote}>{busy === "note" ? "保存中…" : "保存"}</Button>
          {interview && <Button size="sm" variant="ghost" className="gap-1" disabled={busy !== null || !note.trim()} onClick={runReview}><Sparkles className="size-3.5" />{busy === "review" ? "复盘中…" : "AI 复盘"}</Button>}
        </div>
        {review && (
          <div className="space-y-1.5 rounded-xl bg-muted/55 p-3 text-xs">
            {review.reflectionQuestions.length > 0 && <div><p className="font-medium text-muted-foreground">值得想清楚的问题</p><ul className="list-inside list-disc">{review.reflectionQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
            {review.improvements.length > 0 && <div><p className="font-medium text-muted-foreground">下次可以怎么改</p><ul className="list-inside list-disc">{review.improvements.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
        <span className="text-xs font-medium text-muted-foreground">有结果了：</span>
        {nextRounds.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs" disabled={busy !== null} />}>
              进入下一轮<ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              {nextRounds.map((stage) => <DropdownMenuItem key={stage} onClick={() => moveTo(stage)}>{STAGE_LABELS[stage]}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs text-destructive" disabled={busy !== null} onClick={() => moveTo("REJECTED")}>没过</Button>
        <span className="text-[11px] text-muted-foreground">还在等就不用点</span>
      </div>
      {step.followUp && (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3 text-xs">
          <p className="font-medium text-amber-800 dark:text-amber-200">等了一周多还没消息，可以发封邮件问问进度。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs" onClick={() => navigator.clipboard.writeText(communicationDraft("followup", companyName, jobTitle)).then(() => toast.success("已复制跟进邮件，补上称呼和日期再发"), () => toast.error("复制失败"))}>
              <Copy className="size-3.5" />复制跟进邮件
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy !== null} onClick={async () => { const result = await markFollowedUp(row.id); if (!result.ok) toast.error(result.message); else { toast.success("已记下，一周内不再提醒"); router.refresh(); } }}>我已跟进</Button>
          </div>
        </div>
      )}
    </div>
  );
}
