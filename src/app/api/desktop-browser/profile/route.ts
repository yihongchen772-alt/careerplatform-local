import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { describeApplicationProfile, parseApplicationProfile, resolveProfileVariant } from "@/lib/application-profile";
import { db } from "@/lib/db";
import { profileWithMemories, toMemoryView, type MemoryView } from "@/lib/application-memory";

// Consumed by electron/browser-view.js's autofill handler (plain HTTP —
// the Electron main process isn't part of the Next app, see
// electron/main.js's startNextServer for why localhost:PORT is reachable
// from there). Deliberately just the facts the keyword-matcher and AI prompt
// use — no resume file info, that's resolved server-side by the
// answer-questions route instead of round-tripping through the main process.
export async function GET(request: Request) {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const contextKey = params.get("contextKey") || null;
  if (contextKey && contextKey.length > 16384) return NextResponse.json({ error: "页面地址过长" }, { status: 400 });
  const fieldMemories = await db.autofillAnswer.findMany({
    where: { userId: user.id, kind: "field", confirmed: true, OR: [{ contextKey: null }, { contextKey }] },
    select: { questionLabel: true, answer: true, contextKey: true },
    orderBy: { updatedAt: "desc" },
  });
  // 资料方案: explicit choice from the browser, else the one linked to the
  // selected resume, else the default profile.
  const { profile: base, variant } = resolveProfileVariant(
    parseApplicationProfile(user.applicationProfile),
    params.get("variantId"),
    params.get("resumeVersionId")
  );
  const memories = (await db.applicationMemory.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }))
    .map(toMemoryView).filter((row): row is MemoryView => row !== null);
  const structured = profileWithMemories(base, memories, !!variant);
  const summaries = Object.fromEntries(memories.filter((row) => row.enabled && row.content.text && !(variant && ["experience", "project"].includes(row.category))).map((row) => [row.category, row.content.text]));
  const edu = structured.education[0];
  const exp = structured.experiences[0];
  return NextResponse.json({
    fieldMemories,
    mappings: Array.isArray(user.autofillMappings) ? user.autofillMappings.filter((m) => m && typeof m === "object" && !Array.isArray(m) && m.contextKey === contextKey) : [],
    variantName: variant?.name ?? null,
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
    // electron/browser-view.js reads the flat fields and the row lists; the AI gets the
    // readable digest as a known fact.
    major: edu?.major || null,
    degree: edu?.degree || null,
    gpa: edu?.gpa || null,
    educationStart: edu?.start || null,
    educationEnd: edu?.end || null,
    latestCompany: exp?.company || null,
    latestRole: exp?.role || null,
    // Every row, in the user's order: forms with 本科 + 硕士 blocks fill each
    // block from its own row (electron/browser-view.js resolveRepeatField).
    education: structured.education,
    experiences: structured.experiences,
    projects: structured.projects,
    awards: structured.awards,
    // In a direction variant the library remains available in the preview
    // selector, while automatic filling follows the variant's own order.
    library: memories,
    summaries,
    politics: structured.extras.politics || null,
    hometown: structured.extras.hometown || null,
    ethnicity: structured.extras.ethnicity || null,
    english: structured.extras.english || null,
    currentCity: structured.extras.currentCity || null,
    targetRole: structured.extras.targetRole || null,
    selfIntro: structured.extras.selfIntro || null,
    expectedSalary: structured.extras.expectedSalary || null,
    availableFrom: structured.extras.availableFrom || null,
    internshipDuration: structured.extras.internshipDuration || null,
    wechat: structured.extras.wechat || null,
    address: structured.extras.address || null,
    extra: [describeApplicationProfile(structured), ...Object.entries(summaries).map(([category, text]) => `${category === "experience" ? "实习/工作" : category === "project" ? "项目" : category === "award" ? "获奖" : "教育"}整段原文：${text}`)].filter(Boolean).join("\n") || null,
  });
}
