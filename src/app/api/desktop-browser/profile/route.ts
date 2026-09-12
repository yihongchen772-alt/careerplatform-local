import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { describeApplicationProfile, parseApplicationProfile } from "@/lib/application-profile";

// Consumed by electron/browser-view.js's autofill handler (plain HTTP —
// the Electron main process isn't part of the Next app, see
// electron/main.js's startNextServer for why localhost:PORT is reachable
// from there). Deliberately just the fields the keyword-matcher there
// actually uses — no resume file info, that's resolved server-side by the
// answer-questions route instead of round-tripping through the main process.
export async function GET() {
  const user = await requireUser();
  const structured = parseApplicationProfile(user.applicationProfile);
  const edu = structured.education[0];
  const exp = structured.experiences[0];
  return NextResponse.json({
    name: user.name,
    phone: user.phone,
    // `user.email` is the local single-user account's internal identifier
    // (defaults to a placeholder like "me@local") — never a real address,
    // so it must never be handed to the autofill matcher. contactEmail is
    // the one the user actually typed in for this purpose.
    email: user.contactEmail,
    gender: user.gender,
    birthDate: user.birthDate,
    school: user.school,
    targetTrack: user.targetTrack,
    graduationYear: user.graduationYear,
    preferredCities: user.preferredCities,
    // Structured 网申资料 (settings → 网申资料): the keyword matcher in
    // electron/browser-view.js reads the flat fields; the AI gets the
    // readable digest as a known fact.
    major: edu?.major || null,
    degree: edu?.degree || null,
    gpa: edu?.gpa || null,
    educationStart: edu?.start || null,
    educationEnd: edu?.end || null,
    latestCompany: exp?.company || null,
    latestRole: exp?.role || null,
    politics: structured.extras.politics || null,
    hometown: structured.extras.hometown || null,
    ethnicity: structured.extras.ethnicity || null,
    english: structured.extras.english || null,
    currentCity: structured.extras.currentCity || null,
    extra: describeApplicationProfile(structured) || null,
  });
}
