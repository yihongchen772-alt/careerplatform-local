import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkAndSendOnLaunch } from "@/lib/actions/reminder-digest";

export async function POST() {
  const user = await requireUser();
  await checkAndSendOnLaunch(user.id);
  return NextResponse.json({ ok: true });
}
