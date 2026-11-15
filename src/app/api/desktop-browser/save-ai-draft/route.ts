import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

const bodySchema = z.object({
  url: z.string().max(2000),
  contextKey: z.string().max(16384).optional(),
  positionId: z.string().max(100).optional(),
  resumeVersionId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(500),
        value: z.string().trim().min(1).max(10000),
        section: z.string().trim().max(120).optional(),
      })
    )
    .min(1)
    .max(40),
});

const SENSITIVE_LABEL = /密码|验证码|身份证|银行卡|护照|户口|家庭住址|紧急联系人|password|captcha|passport|social security|bank account/i;

function normalizeLabelKey(label: string): string {
  return label.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/[?？*＊:：]+$/, "");
}

function fallbackContextKey(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/i.test(u.protocol)) return null;
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid)$/i.test(k)) u.searchParams.delete(k);
    }
    u.searchParams.sort();
    return `page:v2:${u.href}`;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数格式无效" }, { status: 400 });
  }
  const input = parsed.data;
  if (input.positionId) {
    const pos = await db.position.findFirst({ where: { id: input.positionId, userId: user.id }, select: { id: true } });
    if (!pos) return NextResponse.json({ error: "关联岗位不存在" }, { status: 404 });
  }
  if (input.resumeVersionId) {
    const rv = await db.resumeVersion.findFirst({ where: { id: input.resumeVersionId, userId: user.id }, select: { id: true } });
    if (!rv) return NextResponse.json({ error: "关联简历不存在" }, { status: 404 });
  }

  const contextKey = input.positionId
    ? `job:v1:${input.positionId}`
    : input.contextKey?.trim() || fallbackContextKey(input.url);
  if (!contextKey) {
    return NextResponse.json({ saved: 0 });
  }

  const existing = await db.autofillAnswer.findMany({
    where: { userId: user.id, contextKey },
    orderBy: { updatedAt: "desc" },
  });
  const byKey = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = normalizeLabelKey(row.questionLabel);
    if (!byKey.has(key)) byKey.set(key, row);
  }

  let saved = 0;
  for (const item of input.items) {
    if (SENSITIVE_LABEL.test(item.label) || /\d{17}[\dXx]/.test(item.value)) continue;
    const questionLabel = item.section ? `${item.section} · ${item.label}`.slice(0, 500) : item.label;
    const key = normalizeLabelKey(questionLabel);
    const hit = byKey.get(key) || byKey.get(normalizeLabelKey(item.label));
    const kind = item.value.length > 60 ? "essay" : "short";
    if (hit) {
      await db.autofillAnswer.update({
        where: { id: hit.id },
        data: {
          answer: item.value,
          confirmed: true,
          kind,
          ...(input.resumeVersionId ? { resumeVersionId: input.resumeVersionId } : {}),
        },
      });
    } else {
      await db.autofillAnswer.create({
        data: {
          userId: user.id,
          resumeVersionId: input.resumeVersionId ?? null,
          questionLabel,
          answer: item.value,
          kind,
          confirmed: true,
          contextKey,
        },
      });
    }
    saved++;
  }

  return NextResponse.json({ saved });
}
