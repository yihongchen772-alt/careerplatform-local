import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { EmbeddedBrowser } from "@/components/browser/embedded-browser";
import { parseApplicationProfile } from "@/lib/application-profile";
import { loadKnownSites } from "@/lib/known-sites";

const TERMINAL = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"] as const;

export default async function BrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; positionId?: string }>;
}) {
  const user = await requireUser();
  const { url, positionId } = await searchParams;

  const [resumeVersions, companies, careerCompanies, positions, applications, knownSites] = await Promise.all([
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
  ]);


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
          positions: positions
            .filter((p) => p.jdUrl)
            .map((p) => ({ id: p.id, label: `${p.company.name} · ${p.title}`, url: p.jdUrl! })),
          portals: companies.flatMap((c) =>
            c.applicationPortals.map((p) => ({ id: p.id, name: p.label ? `${c.name} · ${p.label}` : c.name, url: p.url }))
          ),
        }}
        poolPositions={positions
          .filter((p) => p.status === "EVALUATING")
          .map((p) => ({ id: p.id, label: `${p.company.name} · ${p.title}`, companyName: p.company.name, source: p.source }))}
        applications={applications.map((a) => ({
          id: a.id,
          label: `${a.company.name} · ${a.title}`,
          companyName: a.company.name,
        }))}
      />
    </div>
  );
}
