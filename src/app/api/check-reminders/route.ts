import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkAndSendOnLaunch } from "@/lib/actions/reminder-digest";
import { scanInboxOnLaunch } from "@/lib/actions/inbox-scan";

// Electron's main process hits this once per app launch, after the Next
// server is confirmed up. Not tied to any UI — this is how the local build
// gets a "check on open" reminder / inbox scan without a background
// scheduler. Both checks are self-contained no-ops when their respective
// feature isn't configured, and both swallow their own errors.
export async function POST() {
  const user = await requireUser();
  await Promise.all([checkAndSendOnLaunch(user.id), scanInboxOnLaunch(user.id)]);
  return NextResponse.json({ ok: true });
}
