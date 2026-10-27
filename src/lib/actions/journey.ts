"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { entrySchema } from "@/lib/journey";

export async function addJourneyEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "内容不对");
    const entry = await db.journeyEntry.create({ data: { userId: user.id, mood: parsed.data.mood, text: parsed.data.text, about: parsed.data.about || null } });
    revalidatePath("/journey");
    revalidatePath("/dashboard");
    return { id: entry.id };
  });
}

export async function deleteJourneyEntry(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.journeyEntry.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/journey");
    revalidatePath("/dashboard");
    return null;
  });
}
