import { itemDayKey, localDayKey, urgencyOf, whenText, relativeText, type ScheduleItem } from "@/lib/interview-schedule";
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
  const who = (item: ScheduleItem) => [item.companyName, item.title].filter(Boolean).join(" · ");
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
  const windows = live.filter((item) => !item.hasTime && item.source !== "mail");
  if (windows.length) {
    const first = windows[0];
    parts.push(`${windows.length} 个测评 / 截止待完成 · 最早 ${first.companyName ?? first.title} ${whenText(first, now)}`);
  }
  const waiting = live.filter((item) => item.source === "mail").length;
  if (waiting) parts.push(`邮件里 ${waiting} 个时间等你确认`);
  const pressing = todos.filter((todo) => todo.urgency !== "soon" && !todo.staleDays).length;
  parts.push(pressing ? `${pressing} 件事今明两天要处理` : "眼前没有要赶的事");
  return parts;
}
