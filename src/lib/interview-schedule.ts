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
  /** Marked done (笔试 submitted early): nothing left to count down to. */
  completedAt?: Date | string | null;
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
    if (row.completedAt) continue;
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

// ---------- which round a time is for ----------

/** Rounds a time can be booked for. */
export const SCHEDULE_STAGES: ApplicationStage[] = ["ASSESSMENT", "OA", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER"];
const INTERVIEW_ROUNDS: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"];

/** The round an invitation names outright (「二面」「终面」「在线测评」), if any. */
export function stageFromText(text: string): ApplicationStage | null {
  if (/HR\s*面|人力面|综合面/i.test(text)) return "HR_INTERVIEW";
  if (/三面|终面|最终面|final interview/i.test(text)) return "INTERVIEW_3";
  if (/二面|复试|第二轮|second interview/i.test(text)) return "INTERVIEW_2";
  if (/一面|初面|初试|第一轮|群面|first interview/i.test(text)) return "INTERVIEW_1";
  if (/测评|测验|性格测试|assessment/i.test(text)) return "ASSESSMENT";
  if (/笔试|机试|在线测试|\bOA\b|coding test|online test/i.test(text)) return "OA";
  return null;
}

/**
 * The round a time in this text is for, given where the 投递 is: a round
 * named outright; a plain 「面试」 is the current interview round (or 一面
 * if none yet); otherwise the current step if it is a round at all.
 */
export function targetStageFor(current: ApplicationStage, text: string): ApplicationStage | null {
  const named = stageFromText(text);
  if (named) return named;
  if (kindFromText(text) === "interview") return INTERVIEW_ROUNDS.includes(current) ? current : "INTERVIEW_1";
  return SCHEDULE_STAGES.includes(current) ? current : null;
}

/**
 * The rounds offered when adding a time: every bookable round except an
 * interview round already behind the current one (测评 / 笔试 can come at
 * any point, companies differ).
 */
export function scheduleStageChoices(current: ApplicationStage): ApplicationStage[] {
  const round = INTERVIEW_ROUNDS.indexOf(current);
  return SCHEDULE_STAGES.filter((stage) => {
    const index = INTERVIEW_ROUNDS.indexOf(stage);
    return index < 0 || round < 0 || index >= round;
  });
}

/**
 * Which round a new time most likely belongs to: the current one when the
 * 投递 is already at a bookable round, else what the invitation says, else
 * 一面 (the usual first booking after 投递 / 筛选).
 */
export function defaultScheduleStage(current: ApplicationStage, text = ""): ApplicationStage {
  if (SCHEDULE_STAGES.includes(current)) return current;
  return targetStageFor(current, text) ?? "INTERVIEW_1";
}

// ---------- after a step: waiting for the result ----------

/** Days of silence after a finished step before 「该跟进了」. */
export const FOLLOW_UP_DAYS = 7;

export type StepRow = {
  stage: ApplicationStage;
  nextDeadline: Date | string | null;
  nextDeadlineEnd: Date | string | null;
  nextHasTime?: boolean | null;
  completedAt?: Date | string | null;
  followedUpAt?: Date | string | null;
};

export type StepState =
  /** Nothing to say: no time, nothing finished. */
  | { phase: "none" }
  /** A time or deadline still ahead. */
  | { phase: "upcoming" }
  /** A 笔试/测评 deadline has passed and it is not marked done. */
  | { phase: "due"; daysPast: number }
  /** Done on the applicant's side; the company owes a result. */
  | { phase: "waiting"; since: string; days: number; followUp: boolean; byTime: boolean };

const toMs = (value: Date | string) => (typeof value === "string" ? new Date(value) : value).getTime();

/**
 * Where a step stands. Marked done, or a timed step whose slot is over
 * (an interview at 14:00 is done by 15:00) → waiting; how long, and whether
 * it is time to follow up (rests for a while after 「已跟进」).
 */
export function stepState(row: StepRow, now: number): StepState {
  const kind = scheduleKindOf(row.stage);
  let since: number | null = null;
  let byTime = false;
  if (row.completedAt) since = toMs(row.completedAt);
  else if (row.nextHasTime && row.nextDeadline) {
    const end = itemEndMs({ startsAt: new Date(toMs(row.nextDeadline)).toISOString(), endsAt: row.nextDeadlineEnd ? new Date(toMs(row.nextDeadlineEnd)).toISOString() : null, hasTime: true });
    if (end <= now) {
      since = end;
      byTime = true;
    }
  }
  if (since !== null) {
    const days = Math.max(0, Math.floor((now - since) / DAY));
    const lastNudge = row.followedUpAt ? Math.max(toMs(row.followedUpAt), since) : since;
    return { phase: "waiting", since: new Date(since).toISOString(), days, followUp: now - lastNudge >= FOLLOW_UP_DAYS * DAY, byTime };
  }
  if (!row.nextDeadline) return { phase: "none" };
  const item = { startsAt: new Date(toMs(row.nextDeadline)).toISOString(), endsAt: row.nextDeadlineEnd ? new Date(toMs(row.nextDeadlineEnd)).toISOString() : null, hasTime: !!row.nextHasTime };
  if (itemEndMs(item) >= now) return { phase: "upcoming" };
  if (kind === "exam" || kind === "deadline") return { phase: "due", daysPast: Math.max(1, Math.round((now - itemEndMs(item)) / DAY)) };
  return { phase: "none" };
}

/** 「已面完 · 等结果 3 天」「已完成 · 等结果 8 天 · 该跟进了」. */
export function waitingText(stage: ApplicationStage, state: Extract<StepState, { phase: "waiting" }>): string {
  const done = scheduleKindOf(stage) === "interview" ? "已面完" : "已完成";
  const wait = state.days === 0 ? "等结果" : `等结果 ${state.days} 天`;
  return `${done} · ${wait}${state.followUp ? " · 该跟进了" : ""}`;
}

// ---------- overlapping times ----------

export type Slot = { key: string; startsAt: string; endsAt: string | null; label: string };

/** Slots that overlap [start, end) — a booked interview with no end counts as an hour. */
export function overlapping(slots: Slot[], start: Date, end: Date | null, excludeKey?: string | null): Slot[] {
  const from = start.getTime();
  const to = end && end.getTime() > from ? end.getTime() : from + DEFAULT_SLOT_MINUTES * MINUTE;
  return slots.filter((slot) => {
    if (slot.key === excludeKey) return false;
    const slotFrom = new Date(slot.startsAt).getTime();
    const slotEnd = slot.endsAt ? new Date(slot.endsAt).getTime() : NaN;
    const slotTo = Number.isFinite(slotEnd) && slotEnd > slotFrom ? slotEnd : slotFrom + DEFAULT_SLOT_MINUTES * MINUTE;
    return slotFrom < to && from < slotTo;
  });
}

/** Keys of timed items that overlap another timed item in the list. */
export function clashingKeys(items: ScheduleItem[]): Set<string> {
  const timed = items.filter((item) => item.hasTime);
  const keys = new Set<string>();
  for (const item of timed) {
    const start = new Date(item.startsAt);
    const end = item.endsAt ? new Date(item.endsAt) : null;
    const others = overlapping(timed.map((other) => ({ key: other.key, startsAt: other.startsAt, endsAt: other.endsAt, label: other.title })), start, end, item.key);
    if (others.length) keys.add(item.key);
  }
  return keys;
}

/** What a card or list row says about the current step beyond its stage. */
export type StepView = {
  rowId: string;
  stage: ApplicationStage;
  /** waiting: done, company owes a result · due: 笔试/测评 deadline passed, not marked done · open: a round still to do */
  phase: "waiting" | "due" | "open";
  text: string;
  followUp: boolean;
  completed: boolean;
};

export function stepView(row: StepRow & { id: string }, now: number): StepView | null {
  const kind = scheduleKindOf(row.stage);
  if (kind !== "interview" && kind !== "exam") return null;
  const state = stepState(row, now);
  if (state.phase === "waiting") return { rowId: row.id, stage: row.stage, phase: "waiting", text: waitingText(row.stage, state), followUp: state.followUp, completed: !!row.completedAt };
  if (state.phase === "due") return { rowId: row.id, stage: row.stage, phase: "due", text: `截止已过 ${state.daysPast} 天 · 做完了吗？`, followUp: false, completed: false };
  return { rowId: row.id, stage: row.stage, phase: "open", text: "", followUp: false, completed: false };
}
