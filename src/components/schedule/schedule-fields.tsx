"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clock, localDayKey } from "@/lib/interview-schedule";

/**
 * 时间安排 for a 投递 step: a day, optionally a clock time (then it goes on
 * the calendar with a reminder), an end, and where to join. Used by 记录企业
 * 进展, the timeline's 改, and 「添加面试时间」.
 */
export type ScheduleDraft = {
  date: string;
  time: string;
  endTime: string;
  endDate: string;
  meetingInfo: string;
  /** Minutes before, or "" for no reminder. */
  remind: string;
};

export const EMPTY_SCHEDULE: ScheduleDraft = { date: "", time: "", endTime: "", endDate: "", meetingInfo: "", remind: "30" };

export const REMIND_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "开始时" },
  { value: "15", label: "提前 15 分钟" },
  { value: "30", label: "提前 30 分钟" },
  { value: "60", label: "提前 1 小时" },
  { value: "120", label: "提前 2 小时" },
  { value: "1440", label: "提前 1 天" },
  { value: "", label: "不提醒" },
];

export function scheduleDraftFrom(row: {
  nextDeadline: string | null;
  nextDeadlineEnd: string | null;
  nextHasTime?: boolean | null;
  meetingInfo?: string | null;
  remindMinutes?: number | null;
}): ScheduleDraft {
  if (!row.nextDeadline) return { ...EMPTY_SCHEDULE, meetingInfo: row.meetingInfo ?? "" };
  if (row.nextHasTime) {
    const start = new Date(row.nextDeadline);
    const end = row.nextDeadlineEnd ? new Date(row.nextDeadlineEnd) : null;
    return {
      date: localDayKey(start),
      time: clock(start),
      endTime: end && localDayKey(end) === localDayKey(start) ? clock(end) : "",
      endDate: "",
      meetingInfo: row.meetingInfo ?? "",
      remind: row.remindMinutes === null || row.remindMinutes === undefined ? "" : String(row.remindMinutes),
    };
  }
  // A date-only value is UTC midnight of its day.
  return {
    date: row.nextDeadline.slice(0, 10),
    time: "",
    endTime: "",
    endDate: row.nextDeadlineEnd ? row.nextDeadlineEnd.slice(0, 10) : "",
    meetingInfo: row.meetingInfo ?? "",
    remind: "30",
  };
}

export type ScheduleValue = {
  nextDeadline: Date | null;
  nextDeadlineEnd: Date | null;
  nextHasTime: boolean;
  meetingInfo: string | null;
  remindMinutes: number | null;
};

/** The draft as the server takes it, or an error to show. */
export function scheduleFromDraft(draft: ScheduleDraft): { value: ScheduleValue } | { error: string } {
  const meetingInfo = draft.meetingInfo.trim() || null;
  if (!draft.date) {
    if (draft.time) return { error: "填了时间，也请选日期" };
    return { value: { nextDeadline: null, nextDeadlineEnd: null, nextHasTime: false, meetingInfo, remindMinutes: null } };
  }
  if (draft.time) {
    const start = new Date(`${draft.date}T${draft.time}`);
    if (Number.isNaN(start.getTime())) return { error: "日期或时间不对" };
    let end: Date | null = null;
    if (draft.endTime) {
      end = new Date(`${draft.date}T${draft.endTime}`);
      if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return { error: "结束时间要晚于开始时间" };
    }
    return { value: { nextDeadline: start, nextDeadlineEnd: end, nextHasTime: true, meetingInfo, remindMinutes: draft.remind === "" ? null : Number(draft.remind) } };
  }
  const day = new Date(draft.date);
  if (Number.isNaN(day.getTime())) return { error: "日期不对" };
  let end: Date | null = null;
  if (draft.endDate) {
    end = new Date(draft.endDate);
    if (Number.isNaN(end.getTime()) || draft.endDate < draft.date) return { error: "窗口结束日期不能早于开始日期" };
  }
  return { value: { nextDeadline: day, nextDeadlineEnd: end, nextHasTime: false, meetingInfo, remindMinutes: null } };
}

export function ScheduleFields({
  value,
  onChange,
  idPrefix,
  autoFocusDate = false,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  idPrefix: string;
  autoFocusDate?: boolean;
}) {
  const patch = (change: Partial<ScheduleDraft>) => onChange({ ...value, ...change });
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-date`} className="text-xs text-muted-foreground">日期</Label>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            autoFocus={autoFocusDate}
            value={value.date}
            onChange={(event) => patch(event.target.value ? { date: event.target.value } : { date: "", time: "", endTime: "", endDate: "" })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-time`} className="text-xs text-muted-foreground">几点（可不填）</Label>
          <Input
            id={`${idPrefix}-time`}
            type="time"
            value={value.time}
            disabled={!value.date}
            onChange={(event) => patch({ time: event.target.value, ...(event.target.value ? { endDate: "" } : { endTime: "" }) })}
          />
        </div>
        {value.time ? (
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-end`} className="text-xs text-muted-foreground">结束（可不填）</Label>
            <Input id={`${idPrefix}-end`} type="time" value={value.endTime} onChange={(event) => patch({ endTime: event.target.value })} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-window`} className="text-xs text-muted-foreground">窗口结束日（笔试/测评可填）</Label>
            <Input id={`${idPrefix}-window`} type="date" min={value.date || undefined} disabled={!value.date} value={value.endDate} onChange={(event) => patch({ endDate: event.target.value })} />
          </div>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-meeting`} className="text-xs text-muted-foreground">会议链接 / 会议号 / 地点</Label>
          <Input
            id={`${idPrefix}-meeting`}
            value={value.meetingInfo}
            maxLength={2000}
            placeholder="例如：腾讯会议 https://meeting.tencent.com/… 会议号 123 456 789"
            onChange={(event) => patch({ meetingInfo: event.target.value })}
          />
        </div>
        {value.time && (
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-remind`} className="text-xs text-muted-foreground">提醒</Label>
            <select
              id={`${idPrefix}-remind`}
              value={value.remind}
              onChange={(event) => patch({ remind: event.target.value })}
              className="h-8 w-full rounded-xl border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {REMIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        {value.time ? "有具体时间的安排会进日历，到点前弹系统提醒（App 需在运行或常驻托盘）。" : "只填日期就是截止日；填上几点就当作面试/笔试时间，进日历并提醒。"}
      </p>
    </div>
  );
}
