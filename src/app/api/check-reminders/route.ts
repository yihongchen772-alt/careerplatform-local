import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkAndSendOnLaunch } from "@/lib/actions/reminder-digest";

// Electron's main process hits this once per app launch, after the Next
// server is confirmed up. Not tied to any UI — this is how the local build
// gets a "check on open" reminder without a background scheduler.
export async function POST() {
  const user = await requireUser();
  await checkAndSendOnLaunch(user.id);
  return NextResponse.json({ ok: true });
}
