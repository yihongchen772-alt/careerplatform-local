import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
const schema = z.object({ contextKey: z.string().min(1).max(16384), mappings: z.array(z.object({ fieldKey: z.string().min(1).max(2000), ref: z.string().max(3000).regex(/^(?:name|phone|email|gender|birthDate|currentCity|targetRole|selfIntro|politics|hometown|ethnicity|english|summary:(?:education|experience|project|award)|row:(?:education|experience|project|award):[^:]+:(?:school|major|degree|gpa|start|end|company|role|name|description|responsibilities|issuer|level|date|range|summary))$/) })).max(500) });
export async function POST(request: Request) {
  const user = await requireUser();
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "字段对应关系无效" }, { status: 400 });
  await db.$transaction(async (tx) => {
    const saved = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { autofillMappings: true } });
    const existing = Array.isArray(saved.autofillMappings) ? saved.autofillMappings as { contextKey: string; fieldKey: string; ref: string }[] : [];
    const mappings = input.data.mappings.map((m) => ({ ...m, contextKey: input.data.contextKey }));
    await tx.user.update({ where: { id: user.id }, data: { autofillMappings: [...existing.filter((m) => !mappings.some((n) => n.contextKey === m.contextKey && n.fieldKey === m.fieldKey)), ...mappings].slice(-1000) } });
  });
  return NextResponse.json({ ok: true });
}
