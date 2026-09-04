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
import { STAGE_BADGE_VARIANT, STAGE_LABELS } from "@/lib/stage-labels";
import type { InterviewQa } from "@/lib/validation";

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
          include: { attachments: true },
        },
      },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true },
    }),
  ]);

  if (!application) notFound();

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/applications" label="返回投递记录" />
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {application.company.name} · {application.title}
        </h1>
        <div className="mt-2">
          <Badge variant={STAGE_BADGE_VARIANT[application.currentStage]}>
            当前状态：{STAGE_LABELS[application.currentStage]}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>状态流转时间线</CardTitle>
          </CardHeader>
          <CardContent>
            <StageTimeline
              canDelete={application.stageHistory.length > 1}
              entries={application.stageHistory.map((h) => ({
                id: h.id,
                stage: h.stage,
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
              }))}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
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
