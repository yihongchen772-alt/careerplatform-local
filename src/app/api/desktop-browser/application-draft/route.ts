import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { applicationDraftKey, applicationDraftSchema, storeApplicationDraft } from "@/lib/application-draft-store";

export async function GET(request: Request) {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const contextKey = params.get("contextKey");
  if (contextKey) {
    const input = { contextKey, url: params.get("url") || "", resumeVersionId: params.get("resumeVersionId"), variantId: params.get("variantId") };
    const key = input.url ? applicationDraftKey(input) : contextKey;
    let row = await db.applicationDraft.findUnique({ where: { userId_contextKey: { userId: user.id, contextKey: key } } });
    // Read old v1 drafts only if every material context field matches.
    if (!row && input.url) {
      const legacy = await db.applicationDraft.findUnique({ where: { userId_contextKey: { userId: user.id, contextKey } } });
      const content = legacy?.content as { url?: string; resumeVersionId?: string; variantId?: string } | undefined;
      if (content?.url === input.url && (content?.resumeVersionId || "") === (input.resumeVersionId || "") && (content?.variantId || "") === (input.variantId || "")) row = legacy;
    }
    return NextResponse.json(row);
  }
  const rows = await db.applicationDraft.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 50 });
  return NextResponse.json(rows.map((row) => ({ id: row.id, name: row.name, url: row.url, updatedAt: row.updatedAt, contextKey: (row.content as { contextKey?: string }).contextKey || row.contextKey })));
}
export async function POST(request: Request) {
  const user = await requireUser();
  const result = applicationDraftSchema.safeParse(await request.json().catch(() => null));
  if (!result.success) return NextResponse.json({ error: "草稿格式无效" }, { status: 400 });
  const input = result.data;
  if (input.positionId && !await db.position.findFirst({ where: { id: input.positionId, userId: user.id } })) return NextResponse.json({ error: "岗位不存在" }, { status: 400 });
  if (input.resumeVersionId && !await db.resumeVersion.findFirst({ where: { id: input.resumeVersionId, userId: user.id } })) return NextResponse.json({ error: "简历不存在" }, { status: 400 });
  await db.$transaction((tx) => storeApplicationDraft(tx, user.id, input));
  return NextResponse.json({ ok: true });
}
export async function DELETE(request: Request) {
  const user = await requireUser();
  const id = new URL(request.url).searchParams.get("id");
  if (id) await db.applicationDraft.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
