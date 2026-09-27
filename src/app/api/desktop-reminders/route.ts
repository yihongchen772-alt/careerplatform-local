import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { isTrustedLocalRequest } from "@/lib/local-request-guard";
import { acknowledgeEventReminders, claimEventReminders } from "@/lib/event-reminders";
export async function POST(request: Request) {
  const expected = process.env.DESKTOP_REMINDER_TOKEN;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!expected || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected)) || !isTrustedLocalRequest(request.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = z.discriminatedUnion("action", [z.object({ action: z.literal("claim") }), z.object({ action: z.literal("ack"), ids: z.array(z.string()).max(100), claimToken: z.string().uuid() })]).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const user = await requireUser();
  return NextResponse.json(input.data.action === "claim" ? await claimEventReminders(user.id) : await acknowledgeEventReminders(user.id, input.data.ids, input.data.claimToken));
}
