import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { syncAllPortals } from "@/lib/actions/application-sync";
import { notifyPortalSyncWebhook } from "@/lib/webhook-digest";

// Hit by the Electron main process on its own timer (maybeSyncApplications
// in electron/main.js), mirroring /api/job-radar/check. The response's
// `changed` list is what the desktop notification is built from.
export async function POST() {
  await requireUser();
  const result = await syncAllPortals();
  void notifyPortalSyncWebhook(result);
  return NextResponse.json(result);
}
