"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { rereadMailTimes, type RereadResult } from "@/lib/mail-reread";
import { db } from "@/lib/db";

/** 「重新读一遍邮件」: look again for the times the first reading missed. */
export async function rereadMailSchedules(): Promise<ActionResult<RereadResult>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (!(await db.mailAccount.count({ where: { userId: user.id, enabled: true } }))) throw new UserFacingError("还没有连接邮箱，先去「设置 → 邮箱」添加");
    const result = await rereadMailTimes(user.id);
    revalidatePath("/", "layout");
    return result;
  });
}
