import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { ImportSheetDialog } from "@/components/leads/import-sheet-dialog";
import { LeadsTable } from "@/components/leads/leads-table";

export default async function LeadsPage() {
  const user = await requireUser();

  const [leads, resumeVersions] = await Promise.all([
    db.jobLead.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
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
