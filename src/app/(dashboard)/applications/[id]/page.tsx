import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddStageForm } from "@/components/applications/add-stage-form";
import { AttachmentList } from "@/components/applications/attachment-list";
import { ApplicationAttachments } from "@/components/applications/application-attachments";
import { OfferEditForm } from "@/components/applications/offer-edit-form";
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
        <h1 className="text-2xl font-semibold">
          {application.company.name} · {application.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          投递日期 {application.appliedDate.toLocaleDateString()}
          {application.referrer && ` · 内推人：${application.referrer}`}
          {application.source && ` · 渠道：${application.source}`}
          {application.resumeVersion && ` · 简历版本：${application.resumeVersion.name}`}
        </p>
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
          <CardContent className="space-y-4">
            {application.stageHistory.map((h) => (
              <div key={h.id} className="border-l-2 pl-3">
                <div className="flex items-center gap-2">
                  <Badge variant={STAGE_BADGE_VARIANT[h.stage]}>
                    {STAGE_LABELS[h.stage]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {h.enteredAt.toLocaleString()}
                  </span>
                </div>
                {(h.interviewFormat || h.interviewer) && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {h.interviewFormat} {h.interviewer && `· ${h.interviewer}`}
                  </p>
                )}
                {h.note && <p className="mt-1 text-sm">{h.note}</p>}
                {h.nextDeadline && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    下一步截止：{h.nextDeadline.toLocaleDateString()}
                  </p>
                )}
                {h.attachments.length > 0 && (
                  <div className="mt-2">
                    <AttachmentList attachments={h.attachments} />
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <AddStageForm applicationId={application.id} />
          <OfferEditForm
            applicationId={application.id}
            initial={{
              salaryMin: application.salaryMin,
              salaryMax: application.salaryMax,
              offerNote: application.offerNote,
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
