"use server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError } from "@/lib/action-result";
import { mailEventDraftSchema, confirmedWallTime, type MailEventDraft } from "@/lib/mail-calendar";
import { currentStageRow, isTerminalStage } from "@/lib/interview-schedule";
import { syncApplicationEvents } from "@/lib/stage-schedule";
import { z } from "zod";
import { revalidatePath } from "next/cache";
export async function confirmMailCalendar(taskId: string, draft: MailEventDraft, offsetMinutes: number) {
  return toActionResult(async () => {
    const user = await requireUser(); const data = mailEventDraftSchema.parse(draft); z.number().int().min(0).max(525600).parse(offsetMinutes);
    if (!data.title.trim()) throw new UserFacingError("事项标题必填");
    if (data.meetingUrl && !/^https?:\/\//i.test(data.meetingUrl)) throw new UserFacingError("会议链接应为网页地址");
    let startsAt: Date, endsAt: Date | null;
    try { startsAt = confirmedWallTime(data.localStart, data.timeZone); endsAt = data.localEnd ? confirmedWallTime(data.localEnd, data.timeZone) : null; } catch (e) { throw new UserFacingError(e instanceof Error ? e.message : "请核对日期和时区"); }
    if (endsAt && endsAt < startsAt) throw new UserFacingError("结束时间不能早于开始时间");
    const meetingInfo = [data.location.trim(), data.meetingUrl.trim()].filter(Boolean).join(" ").slice(0, 2000) || null;
    const result = await db.$transaction(async (tx) => {
      const task = await tx.personalTask.findFirst({
        where: { id: taskId, userId: user.id },
        include: { application: { select: { id: true, userId: true, currentStage: true, currentStageDate: true, stageHistory: { select: { id: true, stage: true, enteredAt: true, meetingInfo: true } } } } },
      });
      if (!task?.mailEventDraft) throw new UserFacingError("邮件日程草稿不存在");
      if (task.mailEventId) { const saved = await tx.calendarEvent.findFirst({ where: { id: task.mailEventId, userId: user.id } }); if (saved) return { id: saved.id, existing: true, applicationId: task.applicationId }; }
      // A mail about one of the 投递 puts the time on that 投递's current step,
      // so it shows there, in 接下来 and in 日历 — one place to change it.
      const app = task.application && task.application.userId === user.id && !isTerminalStage(task.application.currentStage) ? task.application : null;
      const row = app ? currentStageRow(app, app.stageHistory) : undefined;
      if (app && row) {
        await tx.stageHistory.update({ where: { id: row.id }, data: { nextDeadline: startsAt, nextDeadlineEnd: endsAt && endsAt > startsAt ? endsAt : null, nextHasTime: true, meetingInfo: meetingInfo ?? row.meetingInfo, remindMinutes: offsetMinutes, scheduleSource: null } });
        await syncApplicationEvents(tx, app.id);
        const copy = await tx.calendarEvent.findUniqueOrThrow({ where: { stageHistoryId: row.id }, select: { id: true } });
        await tx.personalTask.update({ where: { id: task.id }, data: { mailEventId: copy.id, mailEventDraft: data, done: true } });
        return { id: copy.id, existing: false, applicationId: app.id };
      }
      const event = await tx.calendarEvent.create({ data: { userId: user.id, title: data.title, description: [data.location && `地点：${data.location}`, data.meetingUrl && `会议：${data.meetingUrl}`, data.evidence, task.note].filter(Boolean).join("\n"), startsAt, endsAt, timeZone: data.timeZone, dateKey: data.localStart.slice(0, 10), meetingInfo, source: "email", reminders: { create: { offsetMinutes, scheduledAt: new Date(startsAt.getTime() - offsetMinutes * 60000) } } } });
      await tx.personalTask.update({ where: { id: task.id }, data: { mailEventId: event.id, mailEventDraft: data, done: true } });
      return { id: event.id, existing: false, applicationId: null };
    });
    revalidatePath("/dashboard"); revalidatePath("/calendar"); revalidatePath("/applications");
    if (result.applicationId) revalidatePath(`/applications/${result.applicationId}`);
    return result;
  });
}
