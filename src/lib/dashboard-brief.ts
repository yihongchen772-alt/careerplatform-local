import { dayLabel, endDayKey, itemDayKey, localDayKey, urgencyOf, whenText, relativeText, type ScheduleItem } from "@/lib/interview-schedule";
import type { Todo } from "@/lib/todos";

/**
 * 总览's line under the greeting: what is booked today (or the next sitting),
 * the 测评 / 截止 still open, and how much is pressing. A 测评 window is not a
 * 「场」, and 投递 that have gone quiet are not today's work — they wait in
 * 待办, folded.
 */
export function dashboardBrief(upcoming: ScheduleItem[], todos: Todo[], now: number): string[] {
  const live = upcoming.filter((item) => urgencyOf(item, now) !== "past");
  const booked = live.filter((item) => item.hasTime && item.source !== "mail" && item.kind !== "deadline");
  // A pill is one line: mail's long titles lose their decoration, then their tail.
  const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const bare = (title: string) => title.replace(/（截止）$/, "").replace(/^预约面试时间\s*·\s*/, "").trim();
  const who = (item: ScheduleItem) => short([item.companyName, bare(item.title)].filter(Boolean).join(" · "), 24);
  const parts: string[] = [];
  const today = localDayKey(new Date(now));
  const todays = booked.filter((item) => itemDayKey(item) === today);
  if (todays.length) {
    const first = todays[0];
    parts.push(`今天 ${whenText(first, now).replace(/^今天\s*/, "")} ${who(first)}${todays.length > 1 ? ` 等 ${todays.length} 场` : ""}`);
  } else if (booked.length) {
    const next = booked[0];
    const when = whenText(next, now);
    // 「后天 13:30」 already says how far; a weekday gets the count.
    parts.push(`下一场 ${when} ${who(next)}${/^(明天|后天)/.test(when) ? "" : `（${relativeText(next, now)}）`}`);
  } else {
    parts.push("7 天内没有约好的面试 / 笔试");
  }
  if (todays.length && booked.length > todays.length) parts.push(`7 天内共 ${booked.length} 场`);
  else if (!todays.length && booked.length > 1) parts.push(`7 天内 ${booked.length} 场`);
  // 「最早」 is the one that closes first, not the one that opened first.
  const windows = live.filter((item) => !item.hasTime && item.source !== "mail").sort((a, b) => endDayKey(a).localeCompare(endDayKey(b)));
  if (windows.length) {
    const first = windows[0];
    const spans = !!first.endsAt && endDayKey(first) !== itemDayKey(first);
    parts.push(`${windows.length} 个测评 / 截止待完成 · 最早 ${short(first.companyName ?? bare(first.title), 14)} ${spans ? `${dayLabel(endDayKey(first), now).date} 截止` : whenText(first, now)}`);
  }
  const waiting = live.filter((item) => item.source === "mail").length;
  if (waiting) parts.push(`邮件里 ${waiting} 个时间等你确认`);
  // What the pills above already name isn't counted again, and 「没有要赶的事」 isn't said beside a 面试 tomorrow.
  const named = new Set(upcoming.flatMap((item) => (item.source === "event" ? [`event-${item.sourceId}`] : item.source === "stage" ? [`next-${item.sourceId}`] : [])));
  const pressing = todos.filter((todo) => todo.urgency !== "soon" && !todo.staleDays && !named.has(todo.id)).length;
  if (pressing) parts.push(`${booked.length || windows.length ? "另有 " : ""}${pressing} 件事今明两天要处理`);
  else if (!todays.length && !windows.length && !waiting && !booked.some((item) => /^(?:今天|明天)/.test(whenText(item, now)))) parts.push("眼前没有要赶的事");
  return parts;
}
