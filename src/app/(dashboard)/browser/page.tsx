import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { EmbeddedBrowser } from "@/components/browser/embedded-browser";

const TERMINAL = ["REJECTED", "ACCEPTED", "DECLINED"] as const;

export default async function BrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const user = await requireUser();
  const { url } = await searchParams;

  const [resumeVersions, companies, careerCompanies, positions, applications] = await Promise.all([
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
  ]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-3 md:min-h-[calc(100vh-5rem)]">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">网申浏览器</h1>
        <p className="text-sm text-muted-foreground">
          用网页上方的滑块调整高度，也可进入专注模式。你手填的基础资料和开放题会自动记住；可在记忆库修改或删除。提交前请核对填充结果，完成后再点「记为已投递」。
        </p>
      </div>
      <EmbeddedBrowser
        initialUrl={url}
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
