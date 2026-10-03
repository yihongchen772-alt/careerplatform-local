"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError } from "@/lib/action-result";
import { normalizeMemoryText } from "@/lib/application-memory";

const editSchema = z.object({
  questionLabel: z.string().trim().min(2).max(500),
  answer: z.string().trim().min(1).max(10000),
  shareAcrossCompanies: z.boolean(),
});

export async function updateAutofillMemory(id: string, input: z.infer<typeof editSchema>) {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = editSchema.safeParse(input);
    if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "回答格式不对");
    const existing = await db.autofillAnswer.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new UserFacingError("这条回答已不存在");
    await db.autofillAnswer.update({
      where: { id },
      data: {
        questionLabel: parsed.data.questionLabel,
        answer: parsed.data.answer,
        // A scoped answer can be deliberately promoted to reusable. Once
        // global, there is no trustworthy original company to restore.
        contextKey: parsed.data.shareAcrossCompanies ? null : existing.contextKey,
        confirmed: true,
      },
    });
    revalidatePath("/settings");
    return null;
  });
}

export async function deleteAutofillMemory(id: string) {
  return toActionResult(async () => {
    const user = await requireUser();
    const answer = await db.autofillAnswer.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!answer) throw new UserFacingError("这条回答已不存在");
    await db.autofillAnswer.delete({ where: { id } });
    revalidatePath("/settings");
    return null;
  });
}

export async function tidyAutofillMemories() {
  return toActionResult(async () => {
    const user = await requireUser();
    const removed = await db.$transaction(async (tx) => {
      const rows = await tx.autofillAnswer.findMany({ where: { userId: user.id, confirmed: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
      const seen = new Set<string>(), duplicates: string[] = [];
      for (const row of rows) {
        const key = JSON.stringify([row.kind, row.contextKey, normalizeMemoryText(row.questionLabel), normalizeMemoryText(row.answer)]);
        if (seen.has(key)) duplicates.push(row.id); else seen.add(key);
      }
      if (duplicates.length) await tx.autofillAnswer.deleteMany({ where: { id: { in: duplicates }, userId: user.id } });
      return duplicates;
    });
    revalidatePath("/settings"); return removed;
  });
}
