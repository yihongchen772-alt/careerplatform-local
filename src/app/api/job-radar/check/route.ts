import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkAllCompanyRadars } from "@/lib/actions/job-radar";

// Electron's main process hits this on its own interval (see
// maybeCheckJobRadar in electron/main.js) — the check IS the notification
// trigger, no separate "due" endpoint needed: a company can only be reported
// "changed" once per successful check, since that check just overwrote the
// stored hash it was compared against.
export async function POST() {
  await requireUser();
  const result = await checkAllCompanyRadars();
  return NextResponse.json(result);
}
