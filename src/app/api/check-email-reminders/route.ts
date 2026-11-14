import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkAndSendOnLaunch } from "@/lib/actions/reminder-digest";
import { checkWebhookDigestOnTick } from "@/lib/webhook-digest";

export async function POST() {
  const user = await requireUser();
  await Promise.all([checkAndSendOnLaunch(user.id), checkWebhookDigestOnTick(user.id)]);
  return NextResponse.json({ ok: true });
}
