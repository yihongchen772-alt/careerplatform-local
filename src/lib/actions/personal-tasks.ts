"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { personalTaskSchema } from "@/lib/validation";
import { duplicateImportedTaskIds } from "@/lib/inbox-identity";

function revalidateTaskPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

export async function createPersonalTask(
  input: z.infer<typeof personalTaskSchema>
) {
  const user = await requireUser();
  const data = personalTaskSchema.parse(input);

  await db.personalTask.create({
    data: {
      userId: user.id,
      title: data.title,
      note: data.note || undefined,
      dueDate: data.dueDate ?? undefined,
      dueDateEnd: data.dueDateEnd ?? undefined,
      positionId: data.positionId || undefined,
      applicationId: data.applicationId || undefined,
    },
  });

  revalidateTaskPaths();
}

export async function updatePersonalTask(
  id: string,
  input: z.infer<typeof personalTaskSchema>
) {
  const user = await requireUser();
  const existing = await db.personalTask.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) throw new Error("未找到该日程");

  const data = personalTaskSchema.parse(input);

  await db.personalTask.update({
    where: { id },
    data: {
      title: data.title,
      note: data.note || null,
      dueDate: data.dueDate ?? null,
      dueDateEnd: data.dueDateEnd ?? null,
      positionId: data.positionId || null,
      applicationId: data.applicationId || null,
    },
  });

  revalidateTaskPaths();
}

export async function toggleTaskDone(id: string, done: boolean) {
  const user = await requireUser();
  await db.personalTask.updateMany({
    where: { id, userId: user.id },
    data: { done },
  });
  revalidateTaskPaths();
}

export async function deletePersonalTask(id: string) {
  const user = await requireUser();
  await db.personalTask.deleteMany({ where: { id, userId: user.id } });
  revalidateTaskPaths();
}

/** User-confirmed cleanup of only identical, untouched pre-fix mail imports. */
export async function cleanupDuplicateImportedTasks(): Promise<number> {
  const user = await requireUser();
  const count = await db.$transaction(async (tx) => {
    const tasks = await tx.personalTask.findMany({ where: { userId: user.id } });
    const ids = duplicateImportedTaskIds(tasks);
    if (ids.length === 0) return 0;
    const result = await tx.personalTask.deleteMany({
      where: {
        userId: user.id,
        id: { in: ids },
        sourceMailKey: null,
        done: false,
        dueDate: null,
        dueDateEnd: null,
        positionId: null,
        applicationId: null,
      },
    });
    return result.count;
  });
  if (count > 0) revalidateTaskPaths();
  return count;
}
