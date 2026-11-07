"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const schema = z.object({ applicationId: z.string().min(1).max(100), text: z.string().max(20000), url: z.string().trim().max(2000).optional() });

/** Paste or correct the JD kept with a 投递 (for the ones the browser could not read). */
export async function saveApplicationJd(input: z.input<typeof schema>): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser(); const data = schema.parse(input);
    const app = await db.application.findFirst({ where: { id: data.applicationId, userId: user.id }, select: { id: true, positionId: true, position: { select: { jdText: true } } } });
    if (!app) throw new UserFacingError("未找到该投递记录");
    const text = data.text.trim(); const url = data.url && /^https?:\/\//i.test(data.url) ? data.url : null;
    await db.application.update({ where: { id: app.id }, data: { jdSnapshot: text || null, ...(data.url !== undefined ? { jdSnapshotUrl: url } : {}) } });
    // 面试准备 / 模拟面试 work from the 岗位's JD: fill it when it has none.
    if (text && app.positionId && !app.position?.jdText?.trim()) await db.position.update({ where: { id: app.positionId }, data: { jdText: text, ...(url ? { jdUrl: url } : {}) } });
    revalidatePath(`/applications/${app.id}`);
    return null;
  });
}
