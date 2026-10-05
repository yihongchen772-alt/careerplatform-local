"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { resyncCurrentStage } from "@/lib/application-stage-history";

function revalidate(applicationId?: string) {
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
}

/** Removes one recognised update; the application falls back to its previous stage. */
export async function undoAutoStageUpdate(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const entry = await db.stageHistory.findFirst({
      where: { id, autoSource: { not: null }, application: { userId: user.id } },
      select: { id: true, applicationId: true, autoSource: true, stageLabel: true },
    });
    if (!entry) throw new UserFacingError("这条自动更新已撤销或不存在");
    await db.$transaction(async (tx) => {
      if (await tx.stageHistory.count({ where: { applicationId: entry.applicationId } }) <= 1) {
        throw new UserFacingError("这是这条投递唯一的进度记录，不能撤销");
      }
      await tx.stageHistory.delete({ where: { id: entry.id } });
      // The portal page usually still shows the same text; remember it so
      // the next sync does not put the undone stage straight back.
      if (entry.autoSource === "portal" && entry.stageLabel) {
        await tx.application.update({ where: { id: entry.applicationId }, data: { autoUndoneStatus: entry.stageLabel } });
      }
      await resyncCurrentStage(tx, entry.applicationId);
    });
    revalidate(entry.applicationId);
    return null;
  });
}

export async function dismissAutoStageUpdates(ids: string[]): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = z.array(z.string().min(1)).max(200).safeParse(ids);
    if (!parsed.success) throw new UserFacingError("请刷新后重试");
    await db.stageHistory.updateMany({
      where: { id: { in: parsed.data }, autoSource: { not: null }, autoSeenAt: null, application: { userId: user.id } },
      data: { autoSeenAt: new Date() },
    });
    revalidate();
    return null;
  });
}

export async function setAutoApplyProgress(enabled: boolean): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { autoApplyProgress: enabled === true } });
    revalidatePath("/settings");
    return null;
  });
}
