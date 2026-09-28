"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError } from "@/lib/action-result";
import { revalidatePath } from "next/cache";
import { NOTE_COLORS } from "@/lib/note-colors";

export async function listNotes() {
  const user = await requireUser();
  return db.desktopNote.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
}
export async function createNote() {
  return toActionResult(async () => {
    const user = await requireUser();
    return db.desktopNote.create({ data: { userId: user.id } });
  });
}
export async function saveNote(input: { id: string; revision: number; content: string; template: string; color: string }) {
  return toActionResult(async () => {
    const user = await requireUser();
    const data = z.object({ id: z.string(), revision: z.number().int().nonnegative(), content: z.string().max(100000), template: z.enum(["blank", "lined"]), color: z.enum(NOTE_COLORS) }).parse(input);
    const result = await db.desktopNote.updateMany({ where: { id: data.id, userId: user.id, revision: data.revision }, data: { content: data.content, template: data.template, color: data.color, revision: { increment: 1 } } });
    if (!result.count) throw new UserFacingError("这张便签在另一窗口已修改或删除。当前草稿已保留，请复制内容后重新打开便签。");
    return { revision: data.revision + 1 };
  });
}
export async function deleteNote(id: string) {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.desktopNote.deleteMany({ where: { id, userId: user.id } });
    return null;
  });
}

const eventSchema = z.object({
  id: z.string().optional(), revision: z.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).max(200), description: z.string().max(20000),
  startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable(), allDay: z.boolean(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timeZone: z.string().max(100),
  noteId: z.string().nullable(), offsetMinutes: z.number().int().min(0).max(525600).nullable(),
});
export async function listEvents() {
  const user = await requireUser();
  return db.calendarEvent.findMany({ where: { userId: user.id }, include: { reminders: true }, orderBy: { startsAt: "asc" } });
}
export async function saveEvent(input: z.input<typeof eventSchema>) {
  return toActionResult(async () => {
    const user = await requireUser();
    const { id, revision, offsetMinutes, ...data } = eventSchema.parse(input);
    const day = new Date(`${data.dateKey}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== data.dateKey) throw new UserFacingError("日期不存在");
    try { new Intl.DateTimeFormat("en", { timeZone: data.timeZone }).format(data.startsAt); } catch { throw new UserFacingError("时区无效"); }
    if (data.endsAt && data.endsAt < data.startsAt) throw new UserFacingError("结束时间不能早于开始时间");
    if (data.noteId && !await db.desktopNote.findFirst({ where: { id: data.noteId, userId: user.id } })) throw new UserFacingError("关联便签不存在");
    const event = await db.$transaction(async (tx) => {
      let saved;
      if (id) {
        if (revision === undefined) throw new UserFacingError("请重新打开事项");
        const updated = await tx.calendarEvent.updateMany({ where: { id, userId: user.id, revision }, data: { ...data, revision: { increment: 1 } } });
        if (!updated.count) throw new UserFacingError("事项已被其他窗口修改，请刷新后重试");
        saved = await tx.calendarEvent.findUniqueOrThrow({ where: { id } });
      } else saved = await tx.calendarEvent.create({ data: { ...data, userId: user.id } });
      const existing = await tx.eventReminder.findUnique({ where: { eventId: saved.id } });
      if (offsetMinutes === null) await tx.eventReminder.deleteMany({ where: { eventId: saved.id } });
      else {
        const scheduledAt = new Date(data.startsAt.getTime() - offsetMinutes * 60000);
        // Editing only text must not redeliver a notification already shown.
        if (!existing || existing.scheduledAt.getTime() !== scheduledAt.getTime()) {
          await tx.eventReminder.upsert({ where: { eventId: saved.id }, create: { eventId: saved.id, scheduledAt, offsetMinutes }, update: { scheduledAt, offsetMinutes, deliveredAt: null, claimUntil: null, claimToken: null } });
        }
      }
      return saved;
    });
    revalidatePath("/calendar");
    return event;
  });
}
export async function deleteEvent(id: string, revision: number) {
  return toActionResult(async () => {
    const user = await requireUser();
    const result = await db.calendarEvent.deleteMany({ where: { id, userId: user.id, revision } });
    if (!result.count) throw new UserFacingError("事项已变化，请刷新后重试");
    revalidatePath("/calendar");
    return null;
  });
}
