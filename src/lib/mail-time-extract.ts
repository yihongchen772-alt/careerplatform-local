import type { MailEventDraft } from "@/lib/mail-calendar";
import { mailTime } from "@/lib/mail-time";

/**
 * A backstop for the AI's reading of an invitation. Recruiting systems write
 * their times in a few fixed ways — 「考试时间：(UTC+08:00) 2026-10-28 19:00:00 ~ …」,
 * 「面试时间：October 30, 2026 Friday 14:00 (GMT+8)」, 「请于 2026-10-30 00:00:00 之前
 * 完成」 — and when the model leaves them out, the calendar stays empty even
 * though the mail says it plainly. This reads those by rule; it only fills in
 * what the model did not.
 */

export type ExtractedTime = {
  /** slot: a booked time; deadline: finish before; booking: the last moment to pick a slot. */
  kind: "slot" | "deadline" | "booking";
  localStart: string;
  localEnd: string;
  timeZone: string;
  deadline: string;
  windowStart: string;
  evidence: string;
  meetingUrl: string;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_WORDS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const DAY_MS = 86_400_000;

type Moment = { y: number; m: number; d: number; hh: number | null; mm: number; offsetMinutes: number | null; start: number; end: number };

const pad = (value: number) => String(value).padStart(2, "0");

function validDay(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const OFFSET = /(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i;

function offsetFrom(text: string): number | null {
  const match = OFFSET.exec(text);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** The clock time right after a date: 「19:00:00」「下午4点00分」「上午10:15」「2:30 PM」. */
function clockAfter(rest: string): { hh: number; mm: number; length: number } | null {
  const match = /^[\s,，]*(?:[(（]?\s*(?:周|星期)[一二三四五六日天]\s*[)）]?|(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)[a-z]*\.?)?[\s,，]*(?:at\s+)?(上午|下午|晚上|中午|早上|AM|PM|am|pm)?\s*(\d{1,2})\s*(?::|：|点|时|h)\s*(\d{1,2})?\s*分?(?::\d{2})?\s*(am|pm|AM|PM)?/.exec(rest);
  if (!match) return null;
  let hh = Number(match[2]);
  const mm = match[3] === undefined ? 0 : Number(match[3]);
  const period = (match[1] ?? match[4] ?? "").toLowerCase();
  if ((period === "下午" || period === "晚上" || period === "pm") && hh < 12) hh += 12;
  if (period === "中午" && hh < 11) hh += 12;
  if ((period === "am" || period === "上午") && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) return null;
  return { hh, mm, length: match[0].length };
}

/**
 * The first date at or after `from` (and the clock time that follows it).
 * `mailYear` fills in a year the text leaves out (「10月30日」).
 */
function momentAt(text: string, from: number, mailDate: Date): Moment | null {
  const slice = text.slice(from);
  const patterns: { re: RegExp; read: (match: RegExpExecArray) => { y: number | null; m: number; d: number } | null }[] = [
    { re: /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/, read: (m) => ({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }) },
    { re: new RegExp(`(${MONTH_WORDS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})`, "i"), read: (m) => ({ y: Number(m[3]), m: MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()], d: Number(m[2]) }) },
    { re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_WORDS})\\.?\\s*,?\\s*(\\d{4})`, "i"), read: (m) => ({ y: Number(m[3]), m: MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()], d: Number(m[1]) }) },
    { re: /(?<![\d/.-])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, read: (m) => ({ y: null, m: Number(m[1]), d: Number(m[2]) }) },
  ];
  let best: { index: number; length: number; y: number | null; m: number; d: number } | null = null;
  for (const { re, read } of patterns) {
    const match = re.exec(slice);
    if (!match) continue;
    const parts = read(match);
    if (!parts || !parts.m || (best && match.index >= best.index)) continue;
    best = { index: match.index, length: match[0].length, ...parts };
  }
  if (!best) return null;
  let year = best.y;
  if (year === null) {
    year = mailDate.getFullYear();
    // 「1月5日」 in a December mail is next year's.
    if (Date.UTC(year, best.m - 1, best.d) < mailDate.getTime() - 60 * DAY_MS) year += 1;
  }
  if (!validDay(year, best.m, best.d)) return null;
  const start = from + best.index;
  const end = start + best.length;
  const clock = clockAfter(text.slice(end, end + 48));
  const tail = text.slice(end + (clock?.length ?? 0), end + (clock?.length ?? 0) + 24);
  // The zone is written either in front (「(UTC+08:00) 2026-…」) or after the time.
  const offset = offsetFrom(text.slice(Math.max(0, start - 16), start)) ?? offsetFrom(tail) ?? (/^\s*[(（]?\s*北京时间|^\s*[(（]?\s*(?:CST|SGT)\b/.test(tail) ? 480 : null);
  return { y: year, m: best.m, d: best.d, hh: clock?.hh ?? null, mm: clock?.mm ?? 0, offsetMinutes: offset, start, end: end + (clock?.length ?? 0) };
}

/** Whole-hour offsets get a zone name the app understands; others are converted to UTC. */
function zoneFor(offsetMinutes: number | null): { zone: string; shift: number } {
  if (offsetMinutes === null) return { zone: "", shift: 0 };
  if (offsetMinutes === 480) return { zone: "Asia/Shanghai", shift: 0 };
  if (offsetMinutes === 0) return { zone: "UTC", shift: 0 };
  if (offsetMinutes % 60 === 0 && Math.abs(offsetMinutes) <= 14 * 60) {
    const hours = Math.abs(offsetMinutes) / 60;
    // Etc/GMT zones are written with the opposite sign.
    return { zone: `Etc/GMT${offsetMinutes > 0 ? "-" : "+"}${hours}`, shift: 0 };
  }
  return { zone: "UTC", shift: -offsetMinutes };
}

function localString(moment: Moment, shiftMinutes: number): string {
  const base = Date.UTC(moment.y, moment.m - 1, moment.d, moment.hh ?? 0, moment.mm) + shiftMinutes * 60_000;
  const date = new Date(base);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

const SLOT_LABEL = new RegExp(
  [
    "(?:面试|笔试|考试|测评|开考|宣讲|会议|场次)(?:开始)?(?:时间|日期)",
    "(?:面试|笔试|考试|测评)(?:安排|场次)",
    "interview\\s+(?:time|date|schedule|slot)",
    "(?:exam|test|assessment|online\\s+assessment)\\s+(?:time|date)",
    "scheduled\\s+(?:for|at|on)",
    "(?<![A-Za-z发邮送截止预约有效期限])时间\\s*[：:]",
  ].join("|"),
  "gi"
);
const BOOKING_LABEL = /(?:可预约期限时间|预约截止(?:时间|日期)?|预约期限|选择截止(?:时间)?|反馈截止(?:时间)?|Appointment\s+Deadline(?:\s+Time)?|Booking\s+Deadline|select\s+(?:a\s+)?(?:slot|time)\s+(?:before|by))/gi;
const DEADLINE_LABEL = /(?:截止(?:时间|日期)?|完成期限|有效期至?|最晚|deadline|due\s+(?:date|by)|(?:before|until|by))\s*[：:（(]?\s*/gi;
const DEADLINE_VERB = /完成|参加|反馈|作答|提交|回复|预约|确认|登录|答题|测评|考试|笔试|complete|submit|respond|finish/i;
const URL_RE = /https?:\/\/[^\s<>()（）\]\[|"'，。；]+/i;

function snippet(text: string, from: number, to: number): string {
  return text.slice(Math.max(0, from), Math.min(text.length, to)).replace(/\s+/g, " ").trim().slice(0, 160);
}

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ");
}

function nextDay(key: string, delta: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  return new Date(date.getTime() + delta * DAY_MS).toISOString().slice(0, 10);
}

/** 「2026-10-30 00:00 之前」 means the end of the 29th. */
function deadlineValue(moment: Moment, shift: number): string {
  const local = localString(moment, shift);
  const [day, clock] = local.split("T");
  if (moment.hh === null) return day;
  if (clock === "00:00") return `${nextDay(day, -1)}T23:59`;
  return local;
}

function urlNear(text: string, from: number, span = 160): string {
  const match = URL_RE.exec(text.slice(from, from + span));
  return match ? match[0].replace(/[.,;:]+$/, "").slice(0, 2000) : "";
}

const MEETING_URL_LABEL = /(?:面试地点\/?链接|面试链接|会议链接|考试链接|测评网址|测评地址|测评链接|笔试链接|作答链接|答题链接|入口|地点\/链接|Meeting\s+Link|Join\s+Link|Link)\s*[：:]?/gi;

function findMeetingUrl(text: string): string {
  MEETING_URL_LABEL.lastIndex = 0;
  for (let match = MEETING_URL_LABEL.exec(text); match; match = MEETING_URL_LABEL.exec(text)) {
    const url = urlNear(text, match.index + match[0].length, 140);
    if (url) return url;
  }
  return "";
}

/**
 * The time a mail names, or null. `mailDate` is when it was sent (it settles a
 * missing year and 「48 小时内」); `exam` says it is a 笔试 / 测评, which often
 * gives a deadline instead of a slot.
 */
export function extractMailTime(input: { subject?: string; body: string; mailDate: Date; exam?: boolean }): ExtractedTime | null {
  const text = normalize(`${input.subject ?? ""} ${input.body}`);
  if (!text.trim()) return null;
  const meetingUrl = findMeetingUrl(text);

  // 1. A booked slot, introduced by its label.
  SLOT_LABEL.lastIndex = 0;
  for (let label = SLOT_LABEL.exec(text); label; label = SLOT_LABEL.exec(text)) {
    const from = label.index + label[0].length;
    const first = momentAt(text.slice(0, from + 90), from, input.mailDate);
    if (!first || first.hh === null) continue;
    // A date in some later sentence is not this label's.
    if (first.start - from > 40 || /[。！？]/.test(text.slice(from, first.start))) continue;
    const { zone, shift } = zoneFor(first.offsetMinutes);
    const start = localString(first, shift);
    let end = "";
    const range = /^\s*(?:[~～—–-]|至|到|to)\s*/i.exec(text.slice(first.end, first.end + 12));
    if (range) {
      const at = first.end + range[0].length;
      const second = momentAt(text.slice(0, at + 40), at, input.mailDate);
      if (second && second.hh !== null && text.slice(at, at + 6).search(/\d{4}|月|[A-Za-z]/) >= 0) {
        end = localString({ ...second, offsetMinutes: second.offsetMinutes ?? first.offsetMinutes }, shift);
      } else {
        const only = /^(\d{1,2})\s*(?::|：|点)\s*(\d{2})?/.exec(text.slice(at, at + 10));
        if (only) {
          let hh = Number(only[1]);
          // 「下午 2:30-3:15」: the end carries no 下午 of its own.
          if (hh < (first.hh ?? 0) && hh + 12 <= 23) hh += 12;
          end = localString({ ...first, hh, mm: Number(only[2] ?? 0) }, shift);
        }
      }
    }
    if (end && end <= start) end = "";
    return {
      kind: "slot",
      localStart: start,
      localEnd: end,
      timeZone: zone,
      deadline: "",
      windowStart: "",
      evidence: snippet(text, label.index, first.end + (range ? 30 : 6)),
      meetingUrl: meetingUrl || urlNear(text, first.end, 400),
    };
  }

  // 2. The last moment to pick a slot (自主预约).
  BOOKING_LABEL.lastIndex = 0;
  for (let label = BOOKING_LABEL.exec(text); label; label = BOOKING_LABEL.exec(text)) {
    const from = label.index + label[0].length;
    const moment = momentAt(text.slice(0, from + 60), from, input.mailDate);
    if (!moment || moment.start - from > 24) continue;
    const { shift } = zoneFor(moment.offsetMinutes);
    return { kind: "booking", localStart: "", localEnd: "", timeZone: "", deadline: deadlineValue(moment, shift), windowStart: "", evidence: snippet(text, label.index, moment.end), meetingUrl };
  }

  // 3. A cut-off for finishing a 笔试 / 测评.
  const cutoff = findDeadline(text, input.mailDate);
  if (cutoff) return { kind: "deadline", localStart: "", localEnd: "", timeZone: "", deadline: cutoff.value, windowStart: "", evidence: cutoff.evidence, meetingUrl };

  // 4. 「48 小时内完成」, counted from the mail's own date.
  if (input.exam) {
    const relative = /(?:请|须|需|务必)?\s*(?:在|于)?\s*(?:收到(?:本)?(?:邮件|通知)(?:后|起)?)?\s*(\d{1,3})\s*(小时|h|个?自然日|日|天)\s*内[^。]{0,16}?(?:完成|作答|参加)|(?:完成|作答)[^。]{0,16}?(\d{1,3})\s*(小时|h|个?自然日|日|天)\s*内/i.exec(text);
    if (relative) {
      const amount = Number(relative[1] ?? relative[3]);
      const unit = relative[2] ?? relative[4];
      const hours = /小时|h/i.test(unit) ? amount : amount * 24;
      if (hours >= 1 && hours <= 24 * 30) {
        const until = new Date(input.mailDate.getTime() + hours * 3_600_000);
        const wall = `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}T${pad(until.getHours())}:${pad(until.getMinutes())}`;
        return { kind: "deadline", localStart: "", localEnd: "", timeZone: "", deadline: wall, windowStart: "", evidence: snippet(text, relative.index, relative.index + relative[0].length), meetingUrl };
      }
    }
  }
  return null;
}

function findDeadline(text: string, mailDate: Date): { value: string; evidence: string } | null {
  // 「2026-10-30 00:00:00 之前完成」: a date, then 前 / 之前 / 止.
  const dates: Moment[] = [];
  for (let at = 0; at < text.length; ) {
    const moment = momentAt(text, at, mailDate);
    if (!moment) break;
    dates.push(moment);
    at = moment.end;
  }
  for (const moment of dates) {
    const after = text.slice(moment.end, moment.end + 10);
    if (!/^\s*(?:之前|以前|前|止|截止|\)?\s*(?:before|at the latest))/i.test(after)) continue;
    const before = text.slice(Math.max(0, moment.end - 70), moment.end);
    const next = text.slice(moment.end, moment.end + 40);
    if (!DEADLINE_VERB.test(before) && !DEADLINE_VERB.test(next)) continue;
    const { shift } = zoneFor(moment.offsetMinutes);
    return { value: deadlineValue(moment, shift), evidence: snippet(text, moment.end - 36, moment.end + 16) };
  }
  DEADLINE_LABEL.lastIndex = 0;
  for (let label = DEADLINE_LABEL.exec(text); label; label = DEADLINE_LABEL.exec(text)) {
    const from = label.index + label[0].length;
    const moment = momentAt(text.slice(0, from + 50), from, mailDate);
    // Only right after the label, not the next date in some later sentence.
    if (!moment || moment.start - from > 16 || /[。！？]/.test(text.slice(from, moment.start))) continue;
    const { shift } = zoneFor(moment.offsetMinutes);
    return { value: deadlineValue(moment, shift), evidence: snippet(text, label.index, moment.end) };
  }
  return null;
}

/** 「预约面试成功」: a slot is already booked, and the mail does not say which. */
const BOOKED = /选择时间成功|预约(?:面试)?成功|已(?:成功)?预约|successfully\s+(?:booked|scheduled|selected)|slot\s+(?:is\s+)?confirmed|confirms\s+receiving\s+your\s+available\s+slot/i;

const NEGATIVE = /取消|cancel|不合适|遗憾|unfortunately|未通过|not\s+(?:been\s+)?selected|reject|已满|验证码|verification\s+code/i;

/** Mail the reader should not take a time from: cancellations, rejections, codes. */
export function mailRulesOutTime(subject: string, type: string, body: string): boolean {
  return NEGATIVE.test(`${subject} ${type}`) || NEGATIVE.test(body.slice(0, 300));
}

export const EXAM_OR_INTERVIEW = /面试|笔试|测评|考试|机试|OA\b|在线测试|interview|assessment|online\s+test|written\s+test|exam/i;

const clean = (value: string | null | undefined) => (value ?? "").trim();

/**
 * The draft to keep for a mail: the AI's when it already names a usable time,
 * else one completed from what the mail's text says. null = nothing to add.
 */
export function completeMailDraft(input: {
  ai: Partial<MailEventDraft> | null | undefined;
  subject: string;
  body: string;
  mailDate: Date;
  type: string;
  company?: string | null;
}): MailEventDraft | null {
  const { ai } = input;
  const base: MailEventDraft = {
    title: clean(ai?.title), localStart: clean(ai?.localStart), localEnd: clean(ai?.localEnd), timeZone: clean(ai?.timeZone), location: clean(ai?.location),
    meetingUrl: clean(ai?.meetingUrl), evidence: clean(ai?.evidence), deadline: clean(ai?.deadline), windowStart: clean(ai?.windowStart), booking: !!ai?.booking,
  };
  // The AI already got a time the app can use.
  if (ai && mailTime(base)) return base;
  if (!EXAM_OR_INTERVIEW.test(`${input.type} ${input.subject}`)) return ai ? base : null;
  if (mailRulesOutTime(input.subject, input.type, input.body)) return ai ? base : null;
  const exam = /笔试|测评|考试|机试|OA\b|在线测试|assessment|online\s+test|written\s+test|exam/i.test(`${input.type} ${input.subject}`) && !/面试|interview/i.test(input.type);
  const found = extractMailTime({ subject: input.subject, body: input.body, mailDate: input.mailDate, exam });
  if (!found) return ai ? base : null;
  // Already booked: the date in such a mail is the booking window, no use now.
  if (found.kind === "booking" && BOOKED.test(`${input.subject} ${input.body.slice(0, 400)}`)) return ai ? base : null;
  // 「华为 笔试」, not the mail's own 「笔试通知：华为」.
  const short = input.type.replace(/(通知|邀请|提醒)$/, "").trim() || input.type;
  const what = clean(base.title) || (input.company ? `${input.company} ${short}` : input.type);
  const title = found.kind === "booking" ? (/预约|选择/.test(what) ? what : `预约面试时间 · ${what}`) : what;
  const merged: MailEventDraft = {
    ...base,
    title: title.slice(0, 200),
    localStart: found.localStart,
    localEnd: found.localEnd,
    timeZone: found.timeZone || base.timeZone,
    deadline: found.deadline,
    windowStart: found.kind === "slot" ? "" : base.windowStart,
    meetingUrl: base.meetingUrl || found.meetingUrl,
    evidence: found.evidence || base.evidence,
    booking: found.kind === "booking",
  };
  // A slot has no deadline of its own; a deadline has no slot.
  if (found.kind !== "slot") merged.localStart = merged.localEnd = "";
  else merged.deadline = "";
  return mailTime(merged) ? merged : ai ? base : null;
}
