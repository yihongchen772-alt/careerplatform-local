import type { Todo } from "@/lib/todos";
import {
  SCHEDULE_KIND_LABELS,
  extractMeetingNumber,
  extractMeetingUrl,
  itemDayKey,
  localDayKey,
  relativeText,
  whenText,
  type ScheduleItem,
} from "@/lib/interview-schedule";

/**
 * The daily reminder mail. Read on the phone before the day starts, so it
 * leads with today's and the next two days' 面试 / 笔试 — time, the meeting
 * or test link to tap, the meeting number — then what needs attention.
 */

const URGENCY_LABEL: Record<Todo["urgency"], string> = { overdue: "已逾期", urgent: "很急", soon: "临近" };

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Today and the next two days, not mail drafts still waiting to be confirmed. */
export function digestSchedule(items: ScheduleItem[], now: number): ScheduleItem[] {
  const today = localDayKey(new Date(now));
  const last = localDayKey(new Date(now + 2 * 86_400_000));
  return items.filter((item) => item.source !== "mail" && itemDayKey(item) <= last && (item.hasTime || (item.endsAt ? item.endsAt.slice(0, 10) : itemDayKey(item)) >= today));
}

export function renderDigestEmail({ todos, schedule, now }: { todos: Todo[]; schedule: ScheduleItem[]; now: number }): { subject: string; html: string } | null {
  if (todos.length === 0 && schedule.length === 0) return null;
  const today = localDayKey(new Date(now));
  const todayItems = schedule.filter((item) => itemDayKey(item) === today && item.hasTime);
  const scheduleRows = schedule.map((item) => {
    const url = extractMeetingUrl(item.meetingInfo);
    const number = extractMeetingNumber(item.meetingInfo);
    const who = [item.companyName, item.title].filter(Boolean).join(" · ");
    const link = url ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:6px;padding:4px 10px;border-radius:999px;background:#4f46e5;color:#fff;text-decoration:none;font-size:13px;">${item.kind === "exam" ? "打开测评" : "进入会议"}</a>` : "";
    return `<tr><td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top;width:140px;">
        <strong>${escapeHtml(whenText(item, now))}</strong><br/><span style="color:#b45309;font-size:12px;">${escapeHtml(relativeText(item, now))}</span>
      </td><td style="padding:10px 12px;border-bottom:1px solid #eee;">
        <span style="font-size:12px;color:#6d28d9;">${SCHEDULE_KIND_LABELS[item.kind]}</span> <strong>${escapeHtml(who)}</strong>
        ${item.jobTitle ? `<br/><span style="color:#666;font-size:13px;">${escapeHtml(item.jobTitle)}</span>` : ""}
        ${item.meetingInfo ? `<br/><span style="color:#444;font-size:13px;">${escapeHtml(item.meetingInfo)}</span>` : ""}
        ${number ? `<br/><span style="color:#444;font-size:13px;">会议号：<strong>${escapeHtml(number)}</strong></span>` : ""}
        ${link ? `<br/>${link}` : ""}
      </td></tr>`;
  }).join("");
  const todoRows = todos.map((todo) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>${escapeHtml(todo.label)}</strong><br/><span style="color:#666;font-size:13px;">${escapeHtml(todo.sublabel)}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${todo.urgency === "soon" ? "#666" : "#dc2626"};white-space:nowrap;">${URGENCY_LABEL[todo.urgency]}</td>
    </tr>`).join("");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;max-width:560px;">
    <h2 style="margin-bottom:4px;">求职罗盘 · 今日提醒</h2>
    ${schedule.length ? `<h3 style="margin:16px 0 6px;font-size:15px;">今天和接下来</h3><table style="width:100%;border-collapse:collapse;">${scheduleRows}</table>` : ""}
    ${todos.length ? `<h3 style="margin:16px 0 6px;font-size:15px;">需要关注（${todos.length}）</h3><table style="width:100%;border-collapse:collapse;">${todoRows}</table>` : ""}
    <p style="color:#999;font-size:12px;margin-top:16px;">在求职罗盘的「投递记录 → 接下来」里可以看到全部安排。</p>
  </div>`;
  const first = todayItems[0];
  const subject = first
    ? `求职罗盘：今天 ${whenText(first, now).replace(/^今天\s*/, "")} ${[first.companyName, first.title].filter(Boolean).join(" ")}${todayItems.length > 1 ? ` 等 ${todayItems.length} 场` : ""}${todos.length ? ` · ${todos.length} 件事需要关注` : ""}`
    : schedule.length
      ? `求职罗盘：接下来 ${schedule.length} 个面试/笔试安排${todos.length ? ` · ${todos.length} 件事需要关注` : ""}`
      : `求职罗盘：${todos.length} 件事需要关注`;
  return { subject: subject.slice(0, 150), html };
}
