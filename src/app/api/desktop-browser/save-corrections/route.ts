import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { memoryCaptureSchema, memorySourceUrl } from "@/lib/application-memory";
import { stageApplicationChanges } from "@/lib/pending-application-change";
import { applicationDraftSchema, storeApplicationDraft } from "@/lib/application-draft-store";

const bodySchema = z.object({
  // Older browser clients omit mode. They must also stage, never silently
  // confirm content. Only the review action can promote a pending capture.
  mode: z.literal("stage").default("stage"),
  resumeVersionId: z.string().min(1).nullish(),
  variantId: z.string().max(100).nullish(),
  contextKey: z.string().max(16384).nullable(),
  sourceUrl: z.string().max(16384),
  draft: applicationDraftSchema.optional(),
  withdrawals: z.array(z.discriminatedUnion("kind", [z.object({ kind: z.literal("answer"), fieldKey: z.string().min(1).max(2000) }), z.object({ kind: z.literal("record"), category: z.enum(["education", "experience", "project", "award"]), captureKey: z.string().min(1).max(200) })])).max(250).default([]),
  records: z.array(memoryCaptureSchema).max(80).default([]),
  answers: z.array(z.object({
    questionLabel: z.string().trim().min(2).max(500), answer: z.string().trim().min(1).max(10000),
    answerId: z.string().optional(), fieldKey: z.string().max(2000).optional(),
    kind: z.enum(["essay", "short", "field"]).default("essay"),
  })).max(250).default([]),
}).refine((body) => body.draft || body.answers.length + body.records.length + body.withdrawals.length > 0, "没有可保存的内容");

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  const input = parsed.data;
  const sourceUrl = memorySourceUrl(input.sourceUrl);
  if (!sourceUrl) return NextResponse.json({ error: "需要有效的来源网页" }, { status: 400 });
  if (input.resumeVersionId && !await db.resumeVersion.findFirst({ where: { id: input.resumeVersionId, userId: user.id } })) return NextResponse.json({ error: "选的简历不存在" }, { status: 400 });
  const jobId = input.contextKey?.startsWith("job:v1:") ? input.contextKey.slice(7) : null;
  if (jobId && !await db.position.findFirst({ where: { id: jobId, userId: user.id } })) return NextResponse.json({ error: "关联岗位不存在" }, { status: 400 });
  if (input.draft && (input.draft.contextKey !== input.contextKey || input.draft.url !== input.sourceUrl || (input.draft.resumeVersionId || "") !== (input.resumeVersionId || "") || (input.draft.variantId || "") !== (input.variantId || ""))) return NextResponse.json({ error: "草稿的岗位、页面或资料方案不一致" }, { status: 400 });
  const result = await db.$transaction(async (tx) => {
    if (input.draft) await storeApplicationDraft(tx, user.id, input.draft);
    const result = await stageApplicationChanges(tx, user.id, { ...input, sourceUrl });
    return { ...result, pendingTotal: await tx.pendingApplicationChange.count({ where: { userId: user.id, status: "pending" } }) };
  });
  if (result.staged) revalidatePath("/settings");
  return NextResponse.json({ saved: 0, pending: result.staged, pendingTotal: result.pendingTotal, draftSaved: !!input.draft, processed: result.processed, unchanged: result.processed - result.staged });
}
