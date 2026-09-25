import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/ui/back-link";
import { AddStageForm } from "@/components/applications/add-stage-form";
import { ApplicationAttachments } from "@/components/applications/application-attachments";
import { ApplicationEditForm } from "@/components/applications/application-edit-form";
import { OfferEditForm } from "@/components/applications/offer-edit-form";
import { StageTimeline } from "@/components/applications/stage-timeline";
import { InterviewQaCard } from "@/components/applications/interview-qa-card";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { applicationStageStyle } from "@/lib/application-stage-style";
import { PortalReviewBanner } from "@/components/applications/portal-review-banner";
import { PortalAssignmentCard } from "@/components/applications/portal-assignment-card";
import { cn } from "@/lib/utils";
import type { InterviewQa } from "@/lib/validation";
import type { StagePostmortem } from "@/lib/actions/stage-postmortem";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const [application, resumeVersions] = await Promise.all([
    db.application.findFirst({
      where: { id, userId: user.id },
      include: {
        company: true,
        resumeVersion: true,
        attachments: true,
        interviewQA: true,
        stageHistory: {
          orderBy: { enteredAt: "asc" },
          include: { attachments: true, postmortem: { select: { content: true } } },
        },
      },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true },
    }),
  ]);

  if (!application) notFound();
  const portals = await db.applicationPortal.findMany({
    where: { companyId: application.companyId },
    select: { id: true, label: true, url: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-[96rem] space-y-6">
      <div className="relative overflow-hidden rounded-[1.8rem] border border-border/65 bg-card/75 p-5 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
        <BackLink href="/applications" label="返回投递记录" />
        <div className="mt-5 flex flex-wrap items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl font-semibold text-primary ring-1 ring-primary/15">{application.company.name.slice(0, 1)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground">{application.company.name}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{application.title}</h1>
          </div>
          <Badge className={cn("h-7 border-0 px-3 text-xs", applicationStageStyle(application.currentStage).pill)}>
            <span className={cn("mr-1 size-1.5 rounded-full", applicationStageStyle(application.currentStage).dot)} />
            {STAGE_LABELS[application.currentStage]}
          </Badge>
          {application.currentStageLabel && <span className="text-sm font-medium text-muted-foreground">{application.currentStageLabel}</span>}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border/55 pt-5 sm:grid-cols-4">
          {[
            { label: "投递日期", value: application.appliedDate.toLocaleDateString("zh-CN") },
            { label: "最近更新", value: application.currentStageDate.toLocaleDateString("zh-CN") },
            { label: "投递渠道", value: application.source || "未记录" },
            { label: "简历版本", value: application.resumeVersion?.name || "未关联" },
          ].map((item) => (
            <div key={item.label} className="min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-1 truncate text-sm font-semibold" title={item.value}>{item.value}</p>
            </div>
          ))}
        </div>
        {application.portalStatus && <p className="mt-4 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs text-muted-foreground">官网最近显示：<span className="font-medium text-foreground">{application.portalStatus}</span>{application.portalStatusAt && <span> · {application.portalStatusAt.toLocaleString("zh-CN")}</span>}</p>}
        </div>
      </div>

      {application.portalSuggestedStage && (
        <PortalReviewBanner items={[{
          id: application.id,
          companyName: application.company.name,
          title: application.title,
          currentStage: application.currentStage,
          suggestedStage: application.portalSuggestedStage,
          portalStatus: application.portalStatus,
        }]} />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="font-semibold">进展时间线</CardTitle>
          </CardHeader>
          <CardContent>
            <StageTimeline
              canDelete={application.stageHistory.length > 1}
              entries={application.stageHistory.map((h) => ({
                id: h.id,
                stage: h.stage,
                stageLabel: h.stageLabel,
                enteredAt: h.enteredAt.toISOString(),
                note: h.note,
                interviewFormat: h.interviewFormat,
                interviewer: h.interviewer,
                nextDeadline: h.nextDeadline?.toISOString() ?? null,
                nextDeadlineEnd: h.nextDeadlineEnd?.toISOString() ?? null,
                attachments: h.attachments.map((a) => ({
                  id: a.id,
                  url: a.url,
                  name: a.name,
                })),
                postmortem: h.postmortem
                  ? (h.postmortem.content as StagePostmortem)
                  : null,
              }))}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <PortalAssignmentCard applicationId={application.id} currentPortalId={application.portalId} portals={portals} />
          <ApplicationEditForm
            applicationId={application.id}
            initial={{
              appliedDate: application.appliedDate,
              referrer: application.referrer,
              source: application.source,
              resumeVersionId: application.resumeVersionId,
            }}
            resumeVersions={resumeVersions}
          />
          <AddStageForm
            applicationId={application.id}
            currentStage={application.currentStage}
          />
          <OfferEditForm
            applicationId={application.id}
            initial={{
              salaryMin: application.salaryMin,
              salaryMax: application.salaryMax,
              offerNote: application.offerNote,
              offerAnnualTotal: application.offerAnnualTotal,
              commuteMinutes: application.commuteMinutes,
              overtimeNote: application.overtimeNote,
              growthNote: application.growthNote,
            }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Offer letter / 其他文件</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationAttachments
            applicationId={application.id}
            initialAttachments={application.attachments}
          />
        </CardContent>
      </Card>

      <InterviewQaCard
        applicationId={application.id}
        resumeVersions={resumeVersions}
        defaultResumeVersionId={application.resumeVersionId}
        initialResult={
          application.interviewQA
            ? (application.interviewQA.content as InterviewQa)
            : null
        }
      />
    </div>
  );
}
