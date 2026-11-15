import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saveLocalFile } from "@/lib/local-storage";
import { rowForSchedule } from "@/lib/schedule-target";
import { cleanSchedule, syncApplicationEvents } from "@/lib/stage-schedule";
import {
  buildScreenshotMeetingInfo,
  parseScreenshotDate,
  resolveScreenshotTargetStage,
  screenshotExtractionSchema,
} from "@/lib/screenshot-extract";

const bodySchema = z.object({
  dataUrl: z.string().startsWith("data:image/png;base64,"),
  applicationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  applyExtraction: z.boolean().optional(),
  extraction: screenshotExtractionSchema.optional(),
});

// 网申浏览器's "截图存档": the visible page (投递成功页, 测评说明, 笔试
// 时间通知) captured by the main process, filed as an attachment on the
// application so the proof lives with the record instead of in a
// screenshots folder nobody finds again — and when OCR/Vision extracts
// exam/interview times or links, optionally applies them to the schedule.
export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不对" }, { status: 400 });
  const { dataUrl, applicationId, name, applyExtraction, extraction } = parsed.data;

  const application = await db.application.findFirst({ where: { id: applicationId, userId: user.id } });
  if (!application) return NextResponse.json({ error: "未找到该投递记录" }, { status: 404 });

  const buffer = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  if (buffer.length > 12 * 1024 * 1024) return NextResponse.json({ error: "截图太大" }, { status: 413 });
  const { url } = await saveLocalFile(buffer, "image/png");

  let appliedSchedule = false;
  const attachment = await db.$transaction(async (tx) => {
    const created = await tx.attachment.create({
      data: { userId: user.id, applicationId, url, name: name.endsWith(".png") ? name : `${name}.png` },
    });
    if (applyExtraction && extraction) {
      const startDate = parseScreenshotDate(extraction.startsAt, extraction.hasTime);
      const endDate = parseScreenshotDate(extraction.endsAt, extraction.hasTime);
      const meetingInfo = buildScreenshotMeetingInfo({
        entryUrl: extraction.entryUrl ?? null,
        accessCode: extraction.accessCode ?? null,
        summary: extraction.summary,
      });
      const targetStage = resolveScreenshotTargetStage(application.currentStage, extraction);
      const placed =
        (await rowForSchedule(tx, application.id, targetStage, {
          kind: "forward",
          auto: { evidence: "截图识别", note: `截图自动识别：${extraction.summary}` },
        })) ??
        (targetStage !== application.currentStage
          ? await rowForSchedule(tx, application.id, application.currentStage, { kind: "manual" })
          : null);
      if (placed && (startDate || meetingInfo)) {
        const currentRow = await tx.stageHistory.findUnique({
          where: { id: placed.rowId },
          select: { nextDeadline: true, nextDeadlineEnd: true, nextHasTime: true, meetingInfo: true, remindMinutes: true },
        });
        if (currentRow) {
          const mergedMeeting = [meetingInfo, currentRow.meetingInfo && !meetingInfo?.includes(currentRow.meetingInfo) ? currentRow.meetingInfo : null]
            .filter(Boolean)
            .join("\n")
            .slice(0, 2000) || null;
          const schedule = cleanSchedule({
            nextDeadline: startDate ?? currentRow.nextDeadline,
            nextDeadlineEnd: startDate ? endDate : currentRow.nextDeadlineEnd,
            nextHasTime: startDate ? extraction.hasTime : currentRow.nextHasTime,
            meetingInfo: mergedMeeting,
            remindMinutes: currentRow.remindMinutes ?? undefined,
          });
          await tx.stageHistory.update({
            where: { id: placed.rowId },
            data: { ...schedule, scheduleSource: null },
          });
          await syncApplicationEvents(tx, application.id);
          appliedSchedule = true;
        }
      }
    }
    return created;
  });

  revalidatePath(`/applications/${applicationId}`);
  if (appliedSchedule) {
    revalidatePath("/applications");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
  }
  return NextResponse.json({ id: attachment.id, url, appliedSchedule });
}
