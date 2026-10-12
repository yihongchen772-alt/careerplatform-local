import type { ApplicationStage } from "@prisma/client";
import { STAGE_LABELS } from "@/lib/stage-labels";

/**
 * 面试 / 笔试 / 截止 — what is coming up, and how to get into it. Shared by
 * the server (which gathers the items) and the client (which counts down),
 * so nothing here touches the database.
 */

export type ScheduleKind = "interview" | "exam" | "deadline" | "event";

export type ScheduleItem = {
  /** Unique across sources: `stage:<rowId>`, `event:<id>`, `mail:<taskId>`. */
  key: string;
  /** A 投递's next step, a calendar item (from an invitation), or a time recognised in a mail but not written anywhere yet. */
  source: "stage" | "event" | "mail";
  sourceId: string;
  kind: ScheduleKind;
  /** ISO. A date-only value is UTC midnight of its day, the way it is stored. */
  startsAt: string;
  endsAt: string | null;
  hasTime: boolean;
  /** 一面 / the company's own name for the step / the invitation's title. */
  title: string;
  applicationId: string | null;
  companyName: string | null;
  jobTitle: string | null;
  meetingInfo: string | null;
  interviewFormat?: string | null;
  remindMinutes?: number | null;
  /** Where a mail item came from (subject / evidence), shown as a hint. */
  evidence?: string | null;
  /** Mail only: the 投递 already has another time the user typed. */
  conflictsWith?: string | null;
};

const TERMINAL: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"];
const MINUTE = 60_000;
const DAY = 86_400_000;
/** An interview with no end time is shown as live for this long. */
const DEFAULT_SLOT_MINUTES = 60;
/** …and stays on the list this long after it ends, for 刚面完 notes. */
const AFTER_END_GRACE_MINUTES = 30;

export function isTerminalStage(stage: ApplicationStage): boolean {
  return TERMINAL.includes(stage);
}

export function scheduleKindOf(stage: ApplicationStage): ScheduleKind {
  if (stage.startsWith("INTERVIEW") || stage === "HR_INTERVIEW") return "interview";
  if (stage === "ASSESSMENT" || stage === "OA") return "exam";
  return "deadline";
}

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = { interview: "面试", exam: "笔试测评", deadline: "截止", event: "日程" };

/** For a calendar item or an invitation, which only has words to go on. */
export function kindFromText(text: string): ScheduleKind {
  if (/笔试|测评|机试|测验|在线测试|\bOA\b|assessment|online test|coding test/i.test(text)) return "exam";
  if (/面试|一面|二面|三面|终面|复试|群面|HR\s*面|interview/i.test(text)) return "interview";
  return "event";
}

/**
 * The first web address in 会议信息. Invitations paste the link straight
 * after Chinese text and punctuation, so the address stops at the first
 * full-width character as well as at whitespace.
 */
export function extractMeetingUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /https?:\/\/[^\s<>"'，。；、！？）】」『』（【「]+/i.exec(text);
  if (!match) return null;
  const url = match[0].replace(/[.,;:!?)\]}>]+$/, "");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** 会议号 — what you type into 腾讯会议 / 飞书 when the link will not open. */
export function extractMeetingNumber(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /(?:会议号|会议 ID|会议ID|Meeting ID|入会码)[：:\s]*([0-9][0-9 \-]{5,16}[0-9])/i.exec(text);
  return match ? match[1].replace(/[\s-]+/g, " ").trim() : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD` of a moment, in this machine's own timezone. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The day an item is on. A date-only value is stored at UTC midnight, so its
 * day is the UTC one; reading it in local time would move it a day back for
 * anyone west of Greenwich.
 */
export function itemDayKey(item: Pick<ScheduleItem, "startsAt" | "hasTime">): string {
  return item.hasTime ? localDayKey(new Date(item.startsAt)) : item.startsAt.slice(0, 10);
}

function endDayKey(item: Pick<ScheduleItem, "startsAt" | "endsAt" | "hasTime">): string {
  if (!item.endsAt) return itemDayKey(item);
  return item.hasTime ? localDayKey(new Date(item.endsAt)) : item.endsAt.slice(0, 10);
}

function dayStart(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** When the item begins: its clock time, or the start of its day. */
export function itemStartMs(item: Pick<ScheduleItem, "startsAt" | "hasTime">): number {
  return item.hasTime ? new Date(item.startsAt).getTime() : dayStart(itemDayKey(item));
}

/** When the item is over: the slot's end, or the end of its (last) day. */
export function itemEndMs(item: Pick<ScheduleItem, "startsAt" | "endsAt" | "hasTime">): number {
  if (item.hasTime) {
    const start = new Date(item.startsAt).getTime();
    const end = item.endsAt ? new Date(item.endsAt).getTime() : NaN;
    return Number.isFinite(end) && end > start ? end : start + DEFAULT_SLOT_MINUTES * MINUTE;
  }
  return dayStart(endDayKey(item)) + DAY - 1;
}

export function isLive(item: Pick<ScheduleItem, "startsAt" | "endsAt" | "hasTime">, now: number): boolean {
  return item.hasTime && itemStartMs(item) <= now && now < itemEndMs(item);
}

/** Still worth showing on 接下来: not long over, and starting within `days`. */
export function isUpcoming(item: Pick<ScheduleItem, "startsAt" | "endsAt" | "hasTime">, now: number, days = 7): boolean {
  const grace = item.hasTime ? AFTER_END_GRACE_MINUTES * MINUTE : 0;
  return itemEndMs(item) + grace >= now && itemStartMs(item) <= now + days * DAY;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 今天 / 明天 / 后天 / 周三, and the date itself for anything further out. */
export function dayLabel(key: string, now: number): { day: string; date: string } {
  const [y, m, d] = key.split("-").map(Number);
  const date = `${m}/${d}`;
  const diff = Math.round((dayStart(key) - dayStart(localDayKey(new Date(now)))) / DAY);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  if (diff === 0) return { day: "今天", date };
  if (diff === 1) return { day: "明天", date };
  if (diff === 2) return { day: "后天", date };
  if (diff === -1) return { day: "昨天", date };
  return { day: weekday, date };
}

export function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 「10/15（周三）14:00」 — no 今天/明天, so it reads the same whenever rendered. */
export function absoluteWhen(isoValue: string, hasTime = true): string {
  const date = new Date(isoValue);
  if (!hasTime) {
    const [y, m, d] = isoValue.slice(0, 10).split("-").map(Number);
    return `${m}/${d}（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）${clock(date)}`;
}

/**
 * 「今天 14:00–15:00」「周三 10/15 09:30」「10/21–10/23」. Near days are
 * named; further ones show the date.
 */
export function whenText(item: Pick<ScheduleItem, "startsAt" | "endsAt" | "hasTime" | "kind">, now: number): string {
  const start = dayLabel(itemDayKey(item), now);
  const near = ["今天", "明天", "后天", "昨天"].includes(start.day);
  const day = near ? start.day : `${start.day} ${start.date}`;
  if (item.hasTime) {
    const begins = new Date(item.startsAt);
    const ends = item.endsAt ? new Date(item.endsAt) : null;
    const sameDay = ends && localDayKey(ends) === localDayKey(begins);
    if (ends && ends.getTime() > begins.getTime()) {
      return sameDay ? `${day} ${clock(begins)}–${clock(ends)}` : `${day} ${clock(begins)} – ${dayLabel(localDayKey(ends), now).date} ${clock(ends)}`;
    }
    return `${day} ${clock(begins)}`;
  }
  if (item.endsAt && endDayKey(item) !== itemDayKey(item)) {
    return `${start.date}–${dayLabel(endDayKey(item), now).date}`;
  }
  return day;
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((dayStart(toKey) - dayStart(fromKey)) / DAY);
}

/** 「还有 35 分钟」「进行中」「窗口还剩 2 天」「已过 1 天」. */
export function relativeText(item: Pick<ScheduleItem, "startsAt" | "endsAt" | "hasTime" | "kind">, now: number): string {
  if (item.hasTime) {
    const start = itemStartMs(item);
    const end = itemEndMs(item);
    if (now >= end) return "已结束";
    if (now >= start) return "进行中";
    const minutes = Math.ceil((start - now) / MINUTE);
    if (minutes <= 1) return "马上开始";
    if (minutes < 60) return `还有 ${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      const rest = minutes % 60;
      return hours < 3 && rest ? `还有 ${hours} 小时 ${rest} 分` : `还有 ${hours} 小时`;
    }
    return `还有 ${daysBetween(localDayKey(new Date(now)), itemDayKey(item))} 天`;
  }
  const today = localDayKey(new Date(now));
  const startKey = itemDayKey(item);
  const lastKey = endDayKey(item);
  if (lastKey !== startKey) {
    if (today < startKey) return daysBetween(today, startKey) === 0 ? "窗口今天开放" : `窗口 ${daysBetween(today, startKey)} 天后开放`;
    const left = daysBetween(today, lastKey);
    return left < 0 ? `窗口已过 ${-left} 天` : left === 0 ? "窗口今天关闭" : `窗口还剩 ${left} 天`;
  }
  const left = daysBetween(today, startKey);
  if (item.kind === "interview") return left < 0 ? `已过 ${-left} 天` : left === 0 ? "今天，时间待定" : `还有 ${left} 天`;
  return left < 0 ? `已过 ${-left} 天` : left === 0 ? "今天截止" : `还有 ${left} 天`;
}

/** For styling: live or within the hour / today / within two days / later / over. */
export function urgencyOf(item: Pick<ScheduleItem, "startsAt" | "endsAt" | "hasTime">, now: number): "now" | "today" | "soon" | "later" | "past" {
  if (now > itemEndMs(item)) return "past";
  if (isLive(item, now) || (item.hasTime && itemStartMs(item) - now <= 60 * MINUTE)) return "now";
  const days = daysBetween(localDayKey(new Date(now)), item.hasTime ? itemDayKey(item) : endDayKey(item));
  if (days <= 0) return "today";
  if (days <= 2) return "soon";
  return "later";
}

export function compareItems(left: ScheduleItem, right: ScheduleItem): number {
  return itemStartMs(left) - itemStartMs(right) || Number(right.hasTime) - Number(left.hasTime) || left.key.localeCompare(right.key);
}

export type StageScheduleRow = {
  id: string;
  stage: ApplicationStage;
  stageLabel?: string | null;
  enteredAt: Date | string;
  nextDeadline: Date | string | null;
  nextDeadlineEnd: Date | string | null;
  nextHasTime?: boolean | null;
  meetingInfo?: string | null;
  remindMinutes?: number | null;
  interviewFormat?: string | null;
};

type ScheduleApplication = {
  id: string;
  title: string;
  companyName: string;
  currentStage: ApplicationStage;
  currentStageDate: Date | string;
};

const iso = (value: Date | string) => (typeof value === "string" ? new Date(value) : value).toISOString();
const ms = (value: Date | string) => (typeof value === "string" ? new Date(value) : value).getTime();

/**
 * The row behind the application's current stage. Matching on the stage and
 * its date (not "the newest row") matters: the first APPLIED row is a
 * date-only midnight that can sort after a same-day real update.
 */
export function currentStageRow<T extends { stage: ApplicationStage; enteredAt: Date | string }>(app: { currentStage: ApplicationStage; currentStageDate: Date | string }, rows: T[]): T | undefined {
  return rows.find((row) => row.stage === app.currentStage && ms(row.enteredAt) === ms(app.currentStageDate))
    ?? rows.filter((row) => row.stage === app.currentStage).sort((a, b) => ms(b.enteredAt) - ms(a.enteredAt))[0];
}

export function stageRowItem(app: ScheduleApplication, row: StageScheduleRow): ScheduleItem | null {
  if (!row.nextDeadline) return null;
  return {
    key: `stage:${row.id}`,
    source: "stage",
    sourceId: row.id,
    kind: scheduleKindOf(row.stage),
    startsAt: iso(row.nextDeadline),
    endsAt: row.nextDeadlineEnd ? iso(row.nextDeadlineEnd) : null,
    hasTime: !!row.nextHasTime,
    title: row.stageLabel?.trim() || STAGE_LABELS[row.stage],
    applicationId: app.id,
    companyName: app.companyName,
    jobTitle: app.title,
    meetingInfo: row.meetingInfo?.trim() || null,
    interviewFormat: row.interviewFormat?.trim() || null,
    remindMinutes: row.remindMinutes ?? null,
  };
}

/**
 * What an application has coming up: its current step's time or deadline,
 * plus any other step that was given a clock time still ahead (an earlier
 * round's deadline is history, but a booked slot is not). Closed
 * applications have nothing coming up.
 */
export function applicationScheduleItems(app: ScheduleApplication, rows: StageScheduleRow[], now: number): ScheduleItem[] {
  if (isTerminalStage(app.currentStage)) return [];
  const current = currentStageRow(app, rows);
  const items: ScheduleItem[] = [];
  for (const row of rows) {
    const item = stageRowItem(app, row);
    if (!item) continue;
    if (row === current || (item.hasTime && itemEndMs(item) + AFTER_END_GRACE_MINUTES * MINUTE >= now)) items.push(item);
  }
  return items.sort(compareItems);
}

/** The one to show on a card: live, else the soonest ahead, else the current step's past one. */
export function nextScheduleItem(items: ScheduleItem[], now: number): ScheduleItem | null {
  const sorted = [...items].sort(compareItems);
  return sorted.find((item) => isUpcoming(item, now, 3650)) ?? sorted[sorted.length - 1] ?? null;
}
