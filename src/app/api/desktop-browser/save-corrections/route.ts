import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { canUpdateReferencedAnswer, companySpecificQuestion, shouldForkGlobalAnswer } from "@/lib/autofill-answer-scope";

const bodySchema = z.object({
  resumeVersionId: z.string().min(1).nullish(),
  contextKey: z.string().max(300).nullable(),
  answers: z.array(z.object({
    questionLabel: z.string().trim().min(2).max(500),
    answer: z.string().trim().min(1).max(10000),
    answerId: z.string().optional(),
    kind: z.enum(["essay", "short", "field"]).default("essay"),
  })).min(1),
});

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

  const { resumeVersionId, contextKey, answers } = parsed.data;
  if (resumeVersionId) {
    const resume = await db.resumeVersion.findFirst({ where: { id: resumeVersionId, userId: user.id }, select: { id: true } });
    if (!resume) return NextResponse.json({ error: "选的简历不存在" }, { status: 400 });
  }

  let saved = 0;
  for (const item of answers) {
    const companySpecific = item.kind === "field"
      ? !["姓名", "学校", "手机", "邮箱", "地址", "专业", "学历", "性别", "出生日期"].includes(item.questionLabel)
      : companySpecificQuestion(item.questionLabel);
    if (companySpecific && !contextKey) continue;
    const defaultScope = companySpecific ? contextKey : null;
    const referenced = item.answerId
      ? await db.autofillAnswer.findFirst({ where: { id: item.answerId, userId: user.id, kind: item.kind }, select: { id: true, contextKey: true, confirmed: true, answer: true } })
      : null;
    // A global answer edited on a particular portal becomes a local variant.
    // The global version can only be changed deliberately in the answer library.
    let scope = referenced?.confirmed && referenced.contextKey === null && contextKey ? contextKey : defaultScope;
    let existing = referenced && canUpdateReferencedAnswer(referenced, scope, contextKey)
      ? referenced
      : await db.autofillAnswer.findFirst({
          where: { userId: user.id, questionLabel: item.questionLabel, contextKey: scope, kind: item.kind, confirmed: true },
          select: { id: true, contextKey: true, confirmed: true, answer: true },
        });
    if (shouldForkGlobalAnswer(existing, contextKey, item.answer)) {
      scope = contextKey;
      existing = await db.autofillAnswer.findFirst({
        where: { userId: user.id, questionLabel: item.questionLabel, contextKey: scope, kind: item.kind, confirmed: true },
        select: { id: true, contextKey: true, confirmed: true, answer: true },
      });
    }
    if (existing) {
      await db.autofillAnswer.update({
        where: { id: existing.id },
        data: { answer: item.answer, questionLabel: item.questionLabel, contextKey: scope, kind: item.kind, confirmed: true },
      });
    } else {
      await db.autofillAnswer.create({
        data: { userId: user.id, resumeVersionId: resumeVersionId ?? null, questionLabel: item.questionLabel, answer: item.answer, contextKey: scope, kind: item.kind, confirmed: true },
      });
    }
    saved++;
  }

  if (saved > 0) revalidatePath("/settings");
  return NextResponse.json({ saved });
}
