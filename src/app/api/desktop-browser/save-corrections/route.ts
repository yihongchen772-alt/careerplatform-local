import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { canUpdateReferencedAnswer, companySpecificQuestion, shouldForkGlobalAnswer } from "@/lib/autofill-answer-scope";
import { memoryCaptureSchema, memorySourceUrl, normalizeMemoryText } from "@/lib/application-memory";
import { storeApplicationMemories } from "@/lib/application-memory-store";

const bodySchema = z.object({
  resumeVersionId: z.string().min(1).nullish(),
  contextKey: z.string().max(16384).nullable(),
  sourceUrl: z.string().max(16384).optional(),
  records: z.array(memoryCaptureSchema).max(80).default([]),
  answers: z.array(z.object({
    questionLabel: z.string().trim().min(2).max(500),
    answer: z.string().trim().min(1).max(10000),
    answerId: z.string().optional(),
    kind: z.enum(["essay", "short", "field"]).default("essay"),
  })).max(250).default([]),
}).refine((body) => body.answers.length + body.records.length > 0, "没有可保存的内容");

/**
 * Store answers explicitly written or corrected by the user. These have
 * priority over AI drafts on future pages; generic questions are shared
 * across portals, while company-specific questions stay on one origin.
 */
export async function POST(request: Request) {
  const user = await requireUser();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  }

  const { resumeVersionId, contextKey, answers, records } = parsed.data;
  const sourceUrl = memorySourceUrl(parsed.data.sourceUrl || "");
  if (records.length && !sourceUrl) return NextResponse.json({ error: "经历记忆需要有效的来源网页" }, { status: 400 });
  if (resumeVersionId) {
    const resume = await db.resumeVersion.findFirst({ where: { id: resumeVersionId, userId: user.id }, select: { id: true } });
    if (!resume) return NextResponse.json({ error: "选的简历不存在" }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
  let saved = 0, processed = 0;
  const known = await tx.autofillAnswer.findMany({ where: { userId: user.id, confirmed: true } });
  const findKnown = (label: string, scope: string | null, kind: string) => known.find((row) => row.kind === kind && row.contextKey === scope && normalizeMemoryText(row.questionLabel) === normalizeMemoryText(label)) ?? null;
  for (const item of answers) {
    const companySpecific = item.kind === "field"
      ? !["姓名", "学校", "手机", "邮箱", "地址", "专业", "学历", "性别", "出生日期"].includes(item.questionLabel)
      : companySpecificQuestion(item.questionLabel);
    if (companySpecific && !contextKey) continue;
    const defaultScope = companySpecific ? contextKey : null;
    const referenced = item.answerId
      ? await tx.autofillAnswer.findFirst({ where: { id: item.answerId, userId: user.id, kind: item.kind }, select: { id: true, contextKey: true, confirmed: true, answer: true } })
      : null;
    // A global answer edited on a particular portal becomes a local variant.
    // The global version can only be changed deliberately in the answer library.
    let scope = referenced?.confirmed && referenced.contextKey === null && contextKey ? contextKey : defaultScope;
    let existing = referenced && canUpdateReferencedAnswer(referenced, scope, contextKey)
      ? referenced
      : findKnown(item.questionLabel, scope, item.kind);
    if (shouldForkGlobalAnswer(existing, contextKey, item.answer)) {
      scope = contextKey;
      existing = findKnown(item.questionLabel, scope, item.kind);
    }
    if (existing) {
      processed++;
      if (existing.confirmed && normalizeMemoryText(existing.answer) === normalizeMemoryText(item.answer)) continue;
      const updated = await tx.autofillAnswer.update({
        where: { id: existing.id },
        data: { answer: item.answer, questionLabel: item.questionLabel, contextKey: scope, kind: item.kind, confirmed: true },
      });
      const index = known.findIndex((row) => row.id === existing.id);
      if (index >= 0) known[index] = updated; else known.push(updated);
    } else {
      const created = await tx.autofillAnswer.create({
        data: { userId: user.id, resumeVersionId: resumeVersionId ?? null, questionLabel: item.questionLabel, answer: item.answer, contextKey: scope, kind: item.kind, confirmed: true },
      });
      known.push(created); processed++;
    }
    saved++;
  }
  const memory = records.length ? await storeApplicationMemories(tx, user.id, records, sourceUrl) : { changed: 0, conflicts: 0 };
  return { saved: saved + memory.changed, recordsSaved: memory.changed, answersSaved: saved, conflicts: memory.conflicts, processed: processed + records.length, unchanged: processed + records.length - saved - memory.changed };
  });
  if (result.saved > 0) revalidatePath("/settings");
  return NextResponse.json(result);
}
