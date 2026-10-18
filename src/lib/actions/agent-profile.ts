"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { inferProfile, markInferredSeen, undoInferredProfile, type InferredRecord } from "@/lib/agent/infer-profile";

/** Opening 总览 with blank 求职方向 / 城市 / 技能: 小欧 works them out once. */
export async function runProfileInference(): Promise<ActionResult<InferredRecord | null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const record = await inferProfile(user.id);
    if (record) { revalidatePath("/settings"); revalidatePath("/pool"); }
    return record;
  });
}

export async function undoProfileInference(): Promise<ActionResult<{ undone: number; kept: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const result = await undoInferredProfile(user.id);
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return result;
  });
}

export async function dismissProfileInference(): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await markInferredSeen(user.id);
    return null;
  });
}
