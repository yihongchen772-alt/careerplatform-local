"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError } from "@/lib/action-result";
import { normalizeMemoryText, memoryCaptureSchema, memoryContent, memoryIdentity, toMemoryView, type MemorySource } from "@/lib/application-memory";
import { parseApplicationProfile } from "@/lib/application-profile";
import { LEARNABLE_FACTS, profileKeyForLabel } from "@/lib/profile-learning";
import type { Prisma } from "@prisma/client";

const acceptSchema = z.object({
  revision: z.number().int().nonnegative(),
  shareAcrossCompanies: z.boolean().default(false),
  recordPreference: z.enum(["version", "replace"]).default("version"),
  target: z.object({ id: z.string(), revision: z.number().int() }).nullable().default(null),
  expectedAnswer: z.object({ id: z.string(), updatedAt: z.string() }).nullable().default(null),
  content: z.record(z.string(), z.string().max(10000)).optional(),
  answer: z.string().trim().min(1).max(10000).optional(),
  enableAutomatic: z.boolean().default(false),
  /** A short answer that is a 网申资料 field (研究方向 …): write it there. */
  toProfile: z.boolean().default(false),
});

/** Writes a reviewed answer into its 网申资料 field. Returns false when the label maps to none. */
async function answerToProfile(tx: Prisma.TransactionClient, userId: string, payload: { questionLabel: string; profileKey?: string }, value: string) {
  const key = payload.profileKey && Object.hasOwn(LEARNABLE_FACTS, payload.profileKey) ? payload.profileKey : profileKeyForLabel(payload.questionLabel);
  if (!key || !Object.hasOwn(LEARNABLE_FACTS, key) || value.length > 1000) return false;
  if (key === "preferredCities") {
    await tx.user.update({ where: { id: userId }, data: { preferredCities: value } });
    return true;
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { applicationProfile: true } });
  const profile = parseApplicationProfile(user.applicationProfile);
  profile.extras = { ...profile.extras, [key]: value };
  await tx.user.update({ where: { id: userId }, data: { applicationProfile: profile as Prisma.InputJsonValue } });
  return true;
}

export async function acceptPendingApplicationChange(id: string, input: z.input<typeof acceptSchema>) {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = acceptSchema.safeParse(input);
    if (!parsed.success) throw new UserFacingError("请刷新待核对内容后重试");
    const choice = parsed.data;
    const result = await db.$transaction(async (tx) => {
      const row = await tx.pendingApplicationChange.findFirst({ where: { id, userId: user.id, status: "pending" } });
      if (!row || row.revision !== choice.revision) throw new UserFacingError("这条待核对内容已变化，请刷新后重新核对");
      let memory = null;
      if (row.kind === "record") {
        const capture = memoryCaptureSchema.safeParse(row.payload);
        if (!capture.success) throw new UserFacingError("这条经历内容不完整");
        const incoming = memoryContent(capture.data.category, choice.content || capture.data.content)!;
        if (!incoming || !memoryCaptureSchema.safeParse({ ...capture.data, content: incoming }).success) throw new UserFacingError("请补全经历名称和其他内容");
        const existing = choice.target ? await tx.applicationMemory.findFirst({ where: { id: choice.target.id, userId: user.id, category: capture.data.category } }) : null;
        if (choice.target && (!existing || existing.revision !== choice.target.revision)) throw new UserFacingError("资料库当前版本已有新修改，请刷新后重新比较");
        if (!existing && choice.recordPreference === "replace") throw new UserFacingError("请先选择要更新的经历");
        const source: MemorySource = { url: row.sourceUrl, captureKey: capture.data.captureKey };
        if (!existing) {
          const identity = memoryIdentity(capture.data.category, incoming);
          if (await tx.applicationMemory.findFirst({ where: { userId: user.id, category: capture.data.category, identity } })) throw new UserFacingError("资料库已有同一条经历，请选择它后另存版本或更新默认版");
          memory = await tx.applicationMemory.create({ data: { userId: user.id, category: capture.data.category, identity, content: incoming, sources: [source], alternatives: [], enabled: choice.enableAutomatic } });
        } else {
          const view = toMemoryView(existing)!;
          // Captures only contain fields this page exposes. Missing fields
          // stay intact; a user-edited full review can deliberately clear one.
          const content = choice.content ? incoming : { ...view.content, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value)) };
          const alternatives = [...view.alternatives];
          const same = JSON.stringify(content) === JSON.stringify(view.content);
          if (choice.recordPreference === "version") {
            if (!same && !alternatives.some((item) => JSON.stringify(item.content) === JSON.stringify(content))) alternatives.push({ content, source: row.sourceUrl });
          } else if (!same) {
            const index = alternatives.findIndex((item) => JSON.stringify(item.content) === JSON.stringify(content));
            if (index >= 0) alternatives.splice(index, 1);
            if (!alternatives.some((item) => JSON.stringify(item.content) === JSON.stringify(view.content))) alternatives.push({ content: view.content, source: "设为默认版前" });
          }
          if (alternatives.length > 5) throw new UserFacingError("这条经历已有 5 个其他版本，请先整理版本；本次内容仍在待核对列表");
          const selected = choice.recordPreference === "replace" ? content : view.content;
          const identity = memoryIdentity(capture.data.category, selected);
          if (await tx.applicationMemory.findFirst({ where: { userId: user.id, category: capture.data.category, identity, id: { not: existing.id } } })) throw new UserFacingError("修改后的名称或日期与另一条经历重复，请先核对归属");
          const sources = view.sources.some((item) => item.url === row.sourceUrl) ? view.sources : [...view.sources, source].slice(-10);
          memory = await tx.applicationMemory.update({ where: { id: existing.id }, data: { content: selected, identity, alternatives, sources, revision: { increment: 1 } } });
        }
      } else if (row.kind === "answer" && choice.toProfile) {
        const answer = z.object({ questionLabel: z.string().trim().min(2).max(500), answer: z.string().trim().min(1).max(10000), profileKey: z.string().max(40).optional() }).safeParse(row.payload);
        if (!answer.success) throw new UserFacingError("这条字段内容不完整");
        if (!await answerToProfile(tx, user.id, answer.data, choice.answer || answer.data.answer)) throw new UserFacingError("这一项对不上网申资料里的字段，请用「记住」");
      } else if (row.kind === "answer") {
        const answer = z.object({ questionLabel: z.string().trim().min(2).max(500), answer: z.string().trim().min(1).max(10000), kind: z.enum(["essay", "short", "field"]) }).safeParse(row.payload);
        if (!answer.success) throw new UserFacingError("这条字段或回答内容不完整");
        const scope = choice.shareAcrossCompanies ? null : row.contextKey;
        if (!scope && !choice.shareAcrossCompanies) throw new UserFacingError("缺少当前岗位或网页范围");
        const current = (await tx.autofillAnswer.findMany({ where: { userId: user.id, confirmed: true, kind: answer.data.kind, contextKey: scope }, orderBy: { updatedAt: "desc" } })).find((item) => normalizeMemoryText(item.questionLabel) === normalizeMemoryText(answer.data.questionLabel));
        if ((current?.id || null) !== (choice.expectedAnswer?.id || null) || (current && current.updatedAt.toISOString() !== choice.expectedAnswer?.updatedAt)) throw new UserFacingError("这个范围内的已保存回答有变化，请刷新后重新比较");
        const value = choice.answer || answer.data.answer;
        // Keep the previous answer as history. Newest confirmed version in
        // the selected scope wins; other scopes remain independent.
        const resume = row.resumeVersionId ? await tx.resumeVersion.findFirst({ where: { id: row.resumeVersionId, userId: user.id } }) : null;
        if (!current || current.answer !== value) await tx.autofillAnswer.create({ data: { userId: user.id, resumeVersionId: resume?.id || null, questionLabel: answer.data.questionLabel, answer: value, kind: answer.data.kind, contextKey: scope, confirmed: true } });
      } else throw new UserFacingError("无法识别这条变化");
      await tx.pendingApplicationChange.update({ where: { id: row.id }, data: { status: "accepted", revision: { increment: 1 } } });
      return memory ? toMemoryView(memory) : null;
    });
    revalidatePath("/settings");
    return result;
  });
}

export async function ignorePendingApplicationChange(id: string, revision: number) {
  return toActionResult(async () => {
    const user = await requireUser();
    const changed = await db.pendingApplicationChange.updateMany({ where: { id, userId: user.id, status: "pending", revision }, data: { status: "ignored", revision: { increment: 1 } } });
    if (!changed.count) throw new UserFacingError("这条内容已有新变化，请刷新后重新核对");
    revalidatePath("/settings");
    return null;
  });
}

/** 「全部记进网申资料」: answers that map to a blank 网申资料 field. */
export async function acceptPendingIntoProfile(items: { id: string; revision: number }[]) {
  return toActionResult(async () => {
    const user = await requireUser();
    const result = await db.$transaction(async (tx) => {
      let saved = 0;
      for (const { id, revision } of items.slice(0, 100)) {
        const row = await tx.pendingApplicationChange.findFirst({ where: { id, userId: user.id, status: "pending", revision, kind: "answer" } });
        const payload = row?.payload as { questionLabel?: string; answer?: string; profileKey?: string } | undefined;
        if (!row || !payload?.questionLabel || !payload.answer) continue;
        if (!await answerToProfile(tx, user.id, { questionLabel: payload.questionLabel, profileKey: payload.profileKey }, payload.answer.trim())) continue;
        await tx.pendingApplicationChange.update({ where: { id: row.id }, data: { status: "accepted", revision: { increment: 1 } } });
        saved++;
      }
      return { saved, skipped: Math.min(items.length, 100) - saved };
    });
    revalidatePath("/settings");
    return result;
  });
}

/** 「全部忽略」 for one 网申: rows changed since they were shown are left alone. */
export async function ignorePendingApplicationChanges(items: { id: string; revision: number }[]) {
  return toActionResult(async () => {
    const user = await requireUser();
    let ignored = 0;
    for (const { id, revision } of items.slice(0, 200)) {
      const changed = await db.pendingApplicationChange.updateMany({ where: { id, userId: user.id, status: "pending", revision }, data: { status: "ignored", revision: { increment: 1 } } });
      ignored += changed.count;
    }
    revalidatePath("/settings");
    return { ignored, skipped: Math.min(items.length, 200) - ignored };
  });
}
