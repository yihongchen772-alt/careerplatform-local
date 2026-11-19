import { NextResponse } from "next/server";
import { toMemoryView, type MemoryView } from "@/lib/application-memory";
import { parseApplicationProfile } from "@/lib/application-profile";
import { db } from "@/lib/db";
import { evaluatePendingChange, loadVisiblePending, toPendingApplicationChangeView } from "@/lib/pending-application-change";
import { requireUser } from "@/lib/session";

export async function GET() {
  const user = await requireUser();
  const [pendingChanges, rememberedAnswers, memories, userRow, defaultResume] = await Promise.all([
    loadVisiblePending(db, user.id),
    db.autofillAnswer.findMany({
      where: { userId: user.id, confirmed: true },
      select: { id: true, questionLabel: true, answer: true, kind: true, contextKey: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 250,
    }),
    db.applicationMemory.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { applicationProfile: true, preferredCities: true } }),
    db.resumeVersion?.findFirst?.({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], select: { id: true, name: true } }) ?? null,
  ]);

  const jobIds = [...new Set(pendingChanges.map((row) => row.contextKey).filter((key): key is string => !!key?.startsWith("job:v1:")).map((key) => key.slice(7)))];
  const positions = jobIds.length
    ? await db.position.findMany({ where: { id: { in: jobIds }, userId: user.id }, select: { id: true, title: true, company: { select: { name: true } } } })
    : [];
  const sources = Object.fromEntries(positions.map((p) => [`job:v1:${p.id}`, `${p.company.name} · ${p.title}`]));
  const profile = parseApplicationProfile(userRow.applicationProfile);
  const profileValues = {
    ...profile.extras,
    preferredCities: userRow.preferredCities ?? "",
  };
  const items = pendingChanges.map((row) => {
    const view = toPendingApplicationChangeView(row);
    if (typeof evaluatePendingChange === "function") {
      view.evaluation = evaluatePendingChange(view, profile, profileValues);
    }
    return view;
  });

  return NextResponse.json({
    total: pendingChanges.length,
    items,
    sources,
    currentMemories: memories.map(toMemoryView).filter((row): row is MemoryView => row !== null),
    currentAnswers: rememberedAnswers.map((a) => ({ ...a, updatedAt: a.updatedAt.toISOString() })),
    profileValues,
    defaultResumeName: defaultResume?.name ?? null,
  });
}
