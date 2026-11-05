import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { EmbeddedBrowser } from "@/components/browser/embedded-browser";
import { parseApplicationProfile } from "@/lib/application-profile";
import { loadKnownSites } from "@/lib/known-sites";
import { currentTimeMs } from "@/lib/dates";
import { parseDraft } from "@/lib/resume-doc";
import { siteKey } from "@/lib/site-key";

const TERMINAL = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"] as const;

export default async function BrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; positionId?: string }>;
}) {
  const user = await requireUser();
  const { url, positionId } = await searchParams;

  const [resumeVersions, companies, careerCompanies, positions, applications, knownSites, tailorings] = await Promise.all([
    db.resumeVersion.findMany({
      where: { userId: user.id, fileUrl: { not: null } },
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: "desc" },
    }),
    // Companies the user has actually applied to, for the 进度同步 dialog —
    // the full directory would bury the handful that matter.
    db.company.findMany({
      where: { applications: { some: { userId: user.id } } },
      select: {
        id: true,
        name: true,
        applicationPortals: {
          select: { id: true, label: true, url: true, lastCheckedAt: true, lastSuccessfulAt: true, lastError: true },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: {
            applications: { where: { userId: user.id, currentStage: { notIn: [...TERMINAL] } } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.company.findMany({
      where: { careerUrl: { not: null } },
      select: { id: true, name: true, careerUrl: true },
      orderBy: { name: "asc" },
    }),
    db.position.findMany({
      where: { userId: user.id },
      include: { company: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    db.application.findMany({
      where: { userId: user.id, currentStage: { notIn: [...TERMINAL] } },
      include: { company: true },
      orderBy: { currentStageDate: "desc" },
    }),
    loadKnownSites(user.id),
    // 定制 versions saved in the last few days: offered for 一键填写 when the browser is back on that job's site.
    db.resumeTailoring.findMany({
      where: { userId: user.id, savedVersionId: { not: null }, updatedAt: { gte: new Date(currentTimeMs() - 3 * 86_400_000) } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { savedVersionId: true, draft: true, savedVersion: { select: { name: true, fileUrl: true } } },
    }),
  ]);
  const tailoredResumes = tailorings.flatMap((row) => {
    const target = parseDraft(row.draft)?.target;
    const site = target?.url ? siteKey(target.url) : null;
    if (!site || !row.savedVersionId || !row.savedVersion?.fileUrl) return [];
    return [{ resumeVersionId: row.savedVersionId, name: row.savedVersion.name, label: [target!.company, target!.title].filter(Boolean).join(" · ") || "这个岗位", site }];
  });


  // The browser frame is the whole page, like a browser window: no page
  // header above its tab strip.
  return (
    <div className="flex flex-col">
      <h1 className="sr-only">网申浏览器</h1>
      <EmbeddedBrowser initialPositionId={positionId}
        initialUrl={url}
        knownSites={knownSites}
        profileVariants={parseApplicationProfile(user.applicationProfile).variants.map((v) => ({ id: v.id, name: v.name, resumeVersionId: v.resumeVersionId ?? null }))}
        resumeVersions={resumeVersions}
        tailoredResumes={tailoredResumes}
        portalCompanies={companies.map((c) => ({
          id: c.id,
          name: c.name,
          activeCount: c._count.applications,
          portals: c.applicationPortals.map((p) => ({
            ...p,
            lastCheckedAt: p.lastCheckedAt?.toISOString() ?? null,
            lastSuccessfulAt: p.lastSuccessfulAt?.toISOString() ?? null,
          })),
        }))}
        quickLinks={{
          companies: careerCompanies.map((c) => ({ id: c.id, name: c.name, url: c.careerUrl! })),
          // Only jobs still to apply to, one tile per company: the applied ones are reached through 进度页.
          positions: positions
            .filter((p) => p.jdUrl && (p.status === "EVALUATING" || p.status === "PLANNED"))
            .filter((p, index, list) => list.findIndex((other) => other.companyId === p.companyId) === index)
            .map((p) => ({ id: p.id, label: `${p.company.name} · ${p.title}`, url: p.jdUrl! })),
          portals: companies.flatMap((c) =>
            c.applicationPortals.map((p) => ({ id: p.id, name: p.label ? `${c.name} · ${p.label}` : c.name, url: p.url }))
          ),
        }}
        poolPositions={positions
          .filter((p) => p.status === "EVALUATING")
          .map((p) => ({ id: p.id, label: `${p.company.name} · ${p.title}`, companyName: p.company.name, source: p.source, title: p.title, jdUrl: p.jdUrl }))}
        applications={applications.map((a) => ({
          id: a.id,
          label: `${a.company.name} · ${a.title}`,
          companyName: a.company.name,
        }))}
      />
    </div>
  );
}
