import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
const schema = z.object({ contextKey: z.string().min(1).max(16384), url: z.string().url().max(16384).refine((v) => /^https?:\/\//i.test(v)), name: z.string().max(200).default("网申填写草稿"), fields: z.array(z.object({ label: z.string().max(200), fieldKey: z.string().max(2000).optional(), section: z.string().max(200).optional(), value: z.string().max(20000), ref: z.string().max(3000).optional(), selected: z.boolean().optional(), remember: z.boolean().optional(), edited: z.boolean().optional() })).max(250), resumeVersionId: z.string().max(100).optional(), variantId: z.string().max(100).optional(), positionId: z.string().max(100).optional() });
export async function GET(request: Request) {
  const user = await requireUser(); const key = new URL(request.url).searchParams.get("contextKey");
  if (key) return NextResponse.json(await db.applicationDraft.findUnique({ where: { userId_contextKey: { userId: user.id, contextKey: key } } }));
  return NextResponse.json(await db.applicationDraft.findMany({ where: { userId: user.id }, select: { id: true, name: true, url: true, updatedAt: true, contextKey: true }, orderBy: { updatedAt: "desc" }, take: 50 }));
}
export async function POST(request: Request) {
  const user = await requireUser(); const result = schema.safeParse(await request.json().catch(() => null));
  if (!result.success) return NextResponse.json({ error: "草稿格式无效" }, { status: 400 });
  const data = result.data;
  if (data.positionId && !await db.position.findFirst({ where: { id: data.positionId, userId: user.id } })) return NextResponse.json({ error: "岗位不存在" }, { status: 400 });
  const fields = data.fields.filter((f) => !/密码|验证码|身份证|证件|银行卡|护照|password|captcha|passport/i.test(f.label));
  await db.applicationDraft.upsert({ where: { userId_contextKey: { userId: user.id, contextKey: data.contextKey } }, create: { userId: user.id, contextKey: data.contextKey, url: data.url, name: data.name, content: { ...data, fields } }, update: { url: data.url, name: data.name, content: { ...data, fields } } });
  return NextResponse.json({ ok: true });
}
export async function DELETE(request: Request) { const user = await requireUser(); const id = new URL(request.url).searchParams.get("id"); if (id) await db.applicationDraft.deleteMany({ where: { id, userId: user.id } }); return NextResponse.json({ ok: true }); }
