import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

const bodySchema = z.object({
  corrections: z
    .array(z.object({ answerId: z.string().min(1), answer: z.string().min(1) }))
    .min(1),
});

/**
 * Consumed by electron/browser-view.js's "save-corrections" IPC handler:
 * after autofill, the user may hand-edit a field the AI got wrong before
 * submitting — this lets that correction overwrite the AutofillAnswer row
 * that produced it, instead of the same mistake surfacing again the next
 * time a similarly-worded question matches it. updateMany + userId scoping
 * so an answerId from another account (or a stale one after the row was
 * deleted) is a silent no-op, not an error.
 */
export async function POST(request: Request) {
  const user = await requireUser();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  }

  let saved = 0;
  for (const c of parsed.data.corrections) {
    const result = await db.autofillAnswer.updateMany({
      where: { id: c.answerId, userId: user.id },
      data: { answer: c.answer },
    });
    saved += result.count;
  }

  return NextResponse.json({ saved });
}
