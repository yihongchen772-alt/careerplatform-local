"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError } from "@/lib/action-result";
import { normalizeMemoryText, memoryCaptureSchema, memoryContent, memoryIdentity, sameMemoryEntity, toMemoryView, type MemorySource } from "@/lib/application-memory";
import { storeApplicationMemories } from "@/lib/application-memory-store";
import type { PendingAnswer } from "@/lib/pending-application-change";

const acceptSchema = z.object({
  shareAcrossCompanies: z.boolean().default(false),
  recordPreference: z.enum(["version", "replace"]).default("version"),
});

export async function acceptPendingApplicationChange(id: string, input: z.infer<typeof acceptSchema>) {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = acceptSchema.safeParse(input);
    if (!parsed.success) throw new UserFacingError("保存范围不对");
    await db.$transaction(async (tx) => {
      const row = await tx.pendingApplicationChange.findFirst({ where: { id, userId: user.id } });
      if (!row) throw new UserFacingError("这条待核对内容已不存在");
      if (row.kind === "record") {
        const capture = memoryCaptureSchema.safeParse(row.payload);
        if (!capture.success) throw new UserFacingError("这条经历内容不完整，请忽略后在资料库中手动添加");
        if (parsed.data.recordPreference === "version") {
          await storeApplicationMemories(tx, user.id, [capture.data], row.sourceUrl);
        } else {
          const incoming = memoryContent(capture.data.category, capture.data.content)!;
          const candidates = await tx.applicationMemory.findMany({ where: { userId: user.id, category: capture.data.category } });
          const exactIdentity = memoryIdentity(capture.data.category, incoming);
          const exact = candidates.find((candidate) => candidate.identity === exactIdentity);
          const compatible = candidates.filter((candidate) => sameMemoryEntity(capture.data.category, candidate.content as Record<string, string>, incoming));
          const existing = exact || (compatible.length === 1 ? compatible[0] : null);
          if (!existing) {
            await storeApplicationMemories(tx, user.id, [capture.data], row.sourceUrl);
          } else {
            const view = toMemoryView(existing)!;
            const alternatives = view.alternatives.filter((item) => JSON.stringify(item.content) !== JSON.stringify(incoming));
            if (JSON.stringify(view.content) !== JSON.stringify(incoming)) alternatives.push({ content: view.content, source: "设为默认版前" });
            const source: MemorySource = { url: row.sourceUrl, captureKey: capture.data.captureKey };
            const sources = view.sources.some((item) => item.url === row.sourceUrl) ? view.sources : [...view.sources, source].slice(-10);
            await tx.applicationMemory.update({ where: { id: existing.id }, data: { content: incoming, identity: exactIdentity, alternatives: alternatives.slice(-5), sources, revision: { increment: 1 } } });
          }
        }
      } else {
        const answer = z.object({
          questionLabel: z.string().trim().min(2).max(500),
          answer: z.string().trim().min(1).max(10000),
          kind: z.enum(["essay", "short", "field"]),
        }).safeParse(row.payload as PendingAnswer);
        if (!answer.success) throw new UserFacingError("这条字段或回答内容不完整");
        const scope = parsed.data.shareAcrossCompanies ? null : row.contextKey;
        if (!scope && !parsed.data.shareAcrossCompanies) throw new UserFacingError("当前网页没有可用的岗位范围；请选择跨企业复用，或忽略这条变化");
        const existing = (await tx.autofillAnswer.findMany({
          where: { userId: user.id, kind: answer.data.kind, contextKey: scope },
          orderBy: { updatedAt: "desc" },
        })).find((item) => normalizeMemoryText(item.questionLabel) === normalizeMemoryText(answer.data.questionLabel));
        const sameQuestion = existing ?? null;
        if (sameQuestion) {
          await tx.autofillAnswer.update({ where: { id: sameQuestion.id }, data: { questionLabel: answer.data.questionLabel, answer: answer.data.answer, confirmed: true } });
        } else {
          await tx.autofillAnswer.create({ data: { userId: user.id, resumeVersionId: row.resumeVersionId, questionLabel: answer.data.questionLabel, answer: answer.data.answer, kind: answer.data.kind, contextKey: scope, confirmed: true } });
        }
      }
      await tx.pendingApplicationChange.delete({ where: { id: row.id } });
    });
    revalidatePath("/settings");
    return null;
  });
}

export async function ignorePendingApplicationChange(id: string) {
  return toActionResult(async () => {
    const user = await requireUser();
    const removed = await db.pendingApplicationChange.deleteMany({ where: { id, userId: user.id } });
    if (!removed.count) throw new UserFacingError("这条待核对内容已不存在");
    revalidatePath("/settings");
    return null;
  });
}
