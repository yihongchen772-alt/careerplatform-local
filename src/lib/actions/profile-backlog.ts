"use server";

import { z } from "zod";
import { requireUser } from "@/lib/session";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { markBacklogSeen } from "@/lib/profile-backlog";

/** Closing the 「已记进网申资料」 notice: it is not shown again. */
export async function dismissBacklogNotices(ids: string[]): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await markBacklogSeen(user.id, z.array(z.string().max(40)).max(80).parse(ids));
    return null;
  });
}
