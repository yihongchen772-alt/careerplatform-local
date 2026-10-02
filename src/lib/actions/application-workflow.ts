"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { toActionResult, UserFacingError } from "@/lib/action-result";
const itemSchema = z.object({ id: z.string().min(1).max(100), title: z.string().trim().min(1).max(200), done: z.boolean(), dueDate: z.string().optional(), taskId: z.string().optional() });
export async function saveApplicationWorkflow(input: { applicationId: string; stage: string; revision: number; items: z.infer<typeof itemSchema>[] }) {
  return toActionResult(async () => {
    const user = await requireUser();
    const data = z.object({ applicationId: z.string(), stage: z.string().regex(/^[A-Z_0-9]+$/), revision: z.number().int().nonnegative(), items: z.array(itemSchema).max(100) }).parse(input);
    if (new Set(data.items.map((i) => i.id)).size !== data.items.length) throw new UserFacingError("清单项目重复");
    const result = await db.$transaction(async (tx) => {
      const app = await tx.application.findFirst({ where: { id: data.applicationId, userId: user.id, workflowRevision: data.revision } });
      if (!app) throw new UserFacingError("清单已在另一窗口修改，请刷新后重试；当前草稿仍保留");
      const all = app.workflowChecklist && typeof app.workflowChecklist === "object" && !Array.isArray(app.workflowChecklist) ? app.workflowChecklist as Record<string, unknown> : {};
      const items = [];
      for (const item of data.items) {
        const dueDate = item.dueDate ? new Date(item.dueDate) : null;
        if (dueDate && Number.isNaN(dueDate.getTime())) throw new UserFacingError("日期无效");
        let taskId = item.taskId;
        if (taskId) {
          const task = await tx.personalTask.findFirst({ where: { id: taskId, userId: user.id, applicationId: app.id } });
          if (!task) taskId = undefined;
          else await tx.personalTask.update({ where: { id: taskId }, data: { title: item.title, dueDate, done: item.done } });
        }
        if (dueDate && !taskId) taskId = (await tx.personalTask.create({ data: { userId: user.id, applicationId: app.id, title: item.title, dueDate, done: item.done } })).id;
        items.push({ ...item, ...(taskId ? { taskId } : {}) });
      }
      await tx.application.update({ where: { id: app.id }, data: { workflowChecklist: JSON.parse(JSON.stringify({ ...all, [data.stage]: items })), workflowRevision: { increment: 1 } } });
      return { items, revision: data.revision + 1 };
    });
    revalidatePath(`/applications/${data.applicationId}`); revalidatePath("/dashboard"); revalidatePath("/calendar"); return result;
  });
}
