import Link from "next/link";
import { Scale } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STAGE_BADGE_VARIANT, STAGE_LABELS } from "@/lib/stage-labels";
import { OfferCompareTable, type OfferRow } from "@/components/compare/offer-compare-table";

export default async function ComparePage() {
  const user = await requireUser();

  const applications = await db.application.findMany({
    where: { userId: user.id, currentStage: { in: ["OFFER", "ACCEPTED"] } },
    include: {
      company: true,
      position: true,
      stageHistory: { orderBy: { enteredAt: "desc" } },
    },
    orderBy: { currentStageDate: "desc" },
  });

  const maxSalary = Math.max(
    0,
    ...applications.map((a) => a.salaryMax ?? a.salaryMin ?? 0)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Offer 对比</h1>
        <p className="text-sm text-muted-foreground">
          汇总所有拿到 offer 或已接受的投递，方便横向比较
        </p>
      </div>

      {applications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <Scale className="size-8 text-muted-foreground/50" />
          <span className="text-sm">
            还没有拿到 offer 的投递记录，等你收到第一个 offer 就会出现在这里
          </span>
        </div>
      ) : (
        <>
          {/* Table on desktop, cards on phones — the same data twice rather
              than a table that scrolls sideways on a 390px screen. */}
          <div className="hidden sm:block">
            <OfferCompareTable
              offers={applications.map((app): OfferRow => {
                const offerStage = app.stageHistory.find(
                  (h) => h.stage === "OFFER" || h.stage === "ACCEPTED"
                );
                return {
                  id: app.id,
                  companyName: app.company.name,
                  title: app.title,
                  stage: app.currentStage,
                  location: app.position?.location ?? null,
                  salaryMin: app.salaryMin,
                  salaryMax: app.salaryMax,
                  offerAnnualTotal: app.offerAnnualTotal,
                  commuteMinutes: app.commuteMinutes,
                  overtimeNote: app.overtimeNote,
                  growthNote: app.growthNote,
                  offerNote: app.offerNote,
                  offerDate: offerStage?.enteredAt.toLocaleDateString() ?? null,
                  decideBy: offerStage?.nextDeadline?.toLocaleDateString() ?? null,
                };
              })}
            />
          </div>

        <div className="grid gap-4 sm:hidden">
          {applications.map((app) => {
            const offerStage = app.stageHistory.find(
              (h) => h.stage === "OFFER" || h.stage === "ACCEPTED"
            );
            const salaryTop = app.salaryMax ?? app.salaryMin ?? 0;
            const isTopSalary = salaryTop > 0 && salaryTop === maxSalary;

            return (
              <Card key={app.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      {app.company.name}
                    </CardTitle>
                    <Badge variant={STAGE_BADGE_VARIANT[app.currentStage]}>
                      {STAGE_LABELS[app.currentStage]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{app.title}</p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">薪资</span>
                    <span className="font-medium">
                      {app.salaryMin || app.salaryMax
                        ? `${app.salaryMin ?? "?"}-${app.salaryMax ?? "?"}K`
                        : "未填写"}
                    </span>
                    {isTopSalary && <Badge>最高</Badge>}
                  </div>
                  {app.position?.location && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">地点</span>
                      <span>{app.position.location}</span>
                    </div>
                  )}
                  {offerStage && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">拿到日期</span>
                      <span>{offerStage.enteredAt.toLocaleDateString()}</span>
                    </div>
                  )}
                  {offerStage?.nextDeadline && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">决策截止</span>
                      <span className="text-destructive">
                        {offerStage.nextDeadline.toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {app.offerNote && (
                    <p className="text-muted-foreground">{app.offerNote}</p>
                  )}
                  <Link
                    href={`/applications/${app.id}`}
                    className="block text-primary underline underline-offset-4"
                  >
                    查看详情
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
