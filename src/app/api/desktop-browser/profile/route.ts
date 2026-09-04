import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

// Consumed by electron/browser-view.js's autofill handler (plain HTTP —
// the Electron main process isn't part of the Next app, see
// electron/main.js's startNextServer for why localhost:PORT is reachable
// from there). Deliberately just the fields the keyword-matcher there
// actually uses — no resume file info, that's resolved server-side by the
// answer-questions route instead of round-tripping through the main process.
export async function GET() {
  const user = await requireUser();
  return NextResponse.json({
    name: user.name,
    phone: user.phone,
    email: user.email,
    school: user.school,
    targetTrack: user.targetTrack,
    graduationYear: user.graduationYear,
    preferredCities: user.preferredCities,
  });
}
