import Link from "next/link";
import { Radar } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ImportSheetDialog } from "@/components/leads/import-sheet-dialog";
import { LeadsTable } from "@/components/leads/leads-table";
import { daysAgo } from "@/lib/dates";

// How far back a radar change is still worth surfacing here — this page is
// for "what's worth looking at right now", not a permanent radar log (that
// stays on /companies, where radarLastChangedAt is always visible per row).
const RADAR_ALERT_WINDOW_DAYS = 14;

export default async function LeadsPage() {
  const user = await requireUser();

  const [leads, resumeVersions, radarAlerts] = await Promise.all([
    db.jobLead.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
    }),
    // 招聘页监控 only ever proves "the page's content changed" — not that a
    // specific new posting exists — so this stays a pointer to go look, not
    // an auto-created JobLead row (which would imply a real, parsed posting).
    db.company.findMany({
      where: {
        radarEnabled: true,
        radarLastChangedAt: { gte: daysAgo(RADAR_ALERT_WINDOW_DAYS) },
      },
      select: { id: true, name: true, careerUrl: true, radarLastChangedAt: true },
      orderBy: { radarLastChangedAt: "desc" },
    }),
  ]);

  const defaultResumeVersionId = resumeVersions.find((r) => r.isDefault)?.id ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">秋招信息库</h1>
          <p className="text-sm text-muted-foreground">
            群里那种大而全的秋招信息表放这里，筛完再把想投的挑进候选岗位池
          </p>
        </div>
        <ImportSheetDialog
          resumeVersions={resumeVersions.map((r) => ({ id: r.id, name: r.name }))}
          defaultResumeVersionId={defaultResumeVersionId}
        />
      </div>

      {radarAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Radar className="size-4" />
              招聘页监控最近检测到变化
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              这些公司的招聘页内容变了，可能有新岗位——只是页面内容变化，不代表一定是新岗位，去看看再决定要不要手动加进来
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {radarAlerts.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0">
                <div>
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.radarLastChangedAt!.toLocaleDateString("zh-CN")} 检测到变化
                  </span>
                </div>
                {c.careerUrl && (
                  <Link
                    href={`/browser?url=${encodeURIComponent(c.careerUrl)}`}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                  >
                    去看看
                  </Link>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <LeadsTable
            leads={leads.map((l) => ({
              id: l.id,
              companyName: l.companyName,
              title: l.title,
              track: l.track,
              department: l.department,
              location: l.location,
              salaryMin: l.salaryMin,
              salaryMax: l.salaryMax,
              deadline: l.deadline?.toISOString() ?? null,
              source: l.source,
              jdUrl: l.jdUrl,
              note: l.note,
              fitScore: l.fitScore,
              fitReason: l.fitReason,
              batch: l.batch,
              promoted: !!l.promotedPositionId,
            }))}
            resumeVersions={resumeVersions.map((r) => ({ id: r.id, name: r.name }))}
            defaultResumeVersionId={defaultResumeVersionId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
