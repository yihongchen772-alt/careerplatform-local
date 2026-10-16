import { ApplicationWorkspace } from "@/components/applications/application-workspace";
import { parseWorkflowChecklist } from "@/lib/application-workflow";
import { parseSubmissionPackage } from "@/lib/submission-package";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddStageForm } from "@/components/applications/add-stage-form";
import { ApplicationAttachments } from "@/components/applications/application-attachments";
import { ApplicationEditForm } from "@/components/applications/application-edit-form";
import { OfferEditForm } from "@/components/applications/offer-edit-form";
import { StageTimeline } from "@/components/applications/stage-timeline";
import { InterviewQaCard } from "@/components/applications/interview-qa-card";
import { AUTO_NOTE_PREFIXES, STAGE_LABELS } from "@/lib/stage-labels";
import { applicationStageStyle } from "@/lib/application-stage-style";
import { PortalReviewBanner } from "@/components/applications/portal-review-banner";
import { AutoProgressBanner } from "@/components/applications/auto-progress-banner";
import { QuickStageMenu } from "@/components/applications/quick-stage-menu";
import { loadAutoProgressItems, loadAutoScheduleItems } from "@/lib/auto-progress";
import { PortalAssignmentCard } from "@/components/applications/portal-assignment-card";
import { ApplicationPager } from "@/components/applications/application-pager";
import { InterviewHub, type HubRow } from "@/components/applications/interview-hub";
import { loadApplicationSchedule } from "@/lib/schedule-loader";
import { currentStageRow, isTerminalStage, stepView } from "@/lib/interview-schedule";
import { currentTimeMs } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { InterviewQa } from "@/lib/validation";
import type { StagePostmortem } from "@/lib/actions/stage-postmortem";

const SECTIONS = [
  { href: "#interview", label: "面试与准备" },
  { href: "#timeline", label: "进展时间线" },
  { href: "#add-stage", label: "记录进展" },
  { href: "#materials", label: "清单与材料" },
  { href: "#interview-qa", label: "面试题" },
  { href: "#offer", label: "Offer" },
];

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ addTime?: string }>;
}) {
  const { id } = await params;
  const { addTime } = await searchParams;
  const user = await requireUser();
  const now = currentTimeMs();

  const [application, resumeVersions] = await Promise.all([
    db.application.findFirst({
      where: { id, userId: user.id },
      include: {
        company: true,
        resumeVersion: true,
        attachments: true,
        interviewQA: true,
        interviewBrief: { select: { id: true } },
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
  const [portals, autoUpdates, autoSchedules, schedule, notesCount, order] = await Promise.all([
    db.applicationPortal.findMany({
      where: { companyId: application.companyId },
      select: { id: true, label: true, url: true },
      orderBy: { createdAt: "asc" },
    }),
    loadAutoProgressItems(user.id, application.id),
    loadAutoScheduleItems(user.id, application.id),
    loadApplicationSchedule(user.id, application.id, new Date(now)),
    // Same rule as 面经库: a step with notes, an interviewer or a format,
    // not just the App's own note from a mail / portal update.
    db.stageHistory.count({
      where: {
        application: { userId: user.id, companyId: application.companyId },
        OR: [{ note: { not: null } }, { interviewer: { not: null } }, { interviewFormat: { not: null } }],
        AND: AUTO_NOTE_PREFIXES.map((prefix) => ({ OR: [{ note: null }, { NOT: { note: { startsWith: prefix } } }] })),
      },
    }),
    // 上一条 / 下一条 when the page was not opened from the list.
    db.application.findMany({ where: { userId: user.id }, select: { id: true }, orderBy: { appliedDate: "desc" } }),
  ]);

  const closed = isTerminalStage(application.currentStage);
  const hubRow = (row: (typeof application.stageHistory)[number]): HubRow => ({
    id: row.id,
    stage: row.stage,
    note: row.note,
    label: row.stageLabel || STAGE_LABELS[row.stage],
    nextDeadline: row.nextDeadline?.toISOString() ?? null,
    nextDeadlineEnd: row.nextDeadlineEnd?.toISOString() ?? null,
    nextHasTime: row.nextHasTime,
    meetingInfo: row.meetingInfo,
    remindMinutes: row.remindMinutes,
  });
  const current = currentStageRow(application, application.stageHistory);
  const step = current && !closed ? stepView(current, now) : null;
  const offerStage = ["OFFER", "ACCEPTED", "DECLINED"].includes(application.currentStage);
  const offerFilled = [application.salaryMin, application.salaryMax, application.offerNote, application.offerAnnualTotal, application.commuteMinutes, application.overtimeNote, application.growthNote].some((value) => value !== null && value !== "");

  return (
    <div className="mx-auto max-w-[96rem] space-y-6">
      <div className="surface-card relative overflow-hidden rounded-xl p-5 sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
        <ApplicationPager id={application.id} fallbackIds={order.map((row) => row.id)} />
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
          <QuickStageMenu applicationId={application.id} companyName={application.company.name} currentStage={application.currentStage} step={step} className="h-7" />
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

      <AutoProgressBanner items={autoUpdates} schedules={autoSchedules} showApplication={false} />

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

      <InterviewHub
        // Fresh state when the times change elsewhere (an email, the timeline).
        key={`${current?.id}-${current?.nextDeadline?.getTime() ?? ""}-${application.currentStage}-${current?.completedAt?.getTime() ?? ""}-${addTime ?? ""}`}
        applicationId={application.id}
        companyName={application.company.name}
        jobTitle={application.title}
        positionId={application.positionId}
        currentStage={application.currentStage}
        closed={closed}
        items={schedule.items}
        currentRow={current ? hubRow(current) : null}
        rows={application.stageHistory.map(hubRow)}
        step={step}
        tasks={schedule.tasks}
        notesCount={notesCount}
        hasQuestions={!!application.interviewQA}
        hasBrief={!!application.interviewBrief}
        autoAdd={addTime === "1"}
        now={now}
      />

      <nav aria-label="页面分区" className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-30 -my-2 flex gap-1 overflow-x-auto rounded-full border border-border/60 bg-card/90 p-1 shadow-sm backdrop-blur-xl md:top-3">
        {SECTIONS.map((section) => (
          <a key={section.href} href={section.href} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {section.label}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card id="timeline" className="scroll-mt-20">
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
                terminatedAtStage: h.terminatedAtStage,
                terminatedAtStageLabel: h.terminatedAtStageLabel,
                enteredAt: h.enteredAt.toISOString(),
                note: h.note,
                interviewFormat: h.interviewFormat,
                interviewer: h.interviewer,
                nextDeadline: h.nextDeadline?.toISOString() ?? null,
                nextDeadlineEnd: h.nextDeadlineEnd?.toISOString() ?? null,
                nextHasTime: h.nextHasTime,
                meetingInfo: h.meetingInfo,
                remindMinutes: h.remindMinutes,
                scheduleSource: h.scheduleSource,
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
          <AddStageForm
            // Re-mount when the stage changes elsewhere (改进度 menu, undo,
            // auto update) so the form never re-submits a stale stage.
            key={`${application.currentStage}-${application.currentStageDate.getTime()}`}
            applicationId={application.id}
            currentStage={application.currentStage}
          />
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
          <PortalAssignmentCard applicationId={application.id} currentPortalId={application.portalId} portals={portals} />
        </div>
      </div>

      <div id="materials" className="scroll-mt-20 space-y-6">
        <ApplicationWorkspace key={`${application.id}-${application.currentStage}`} id={application.id} company={application.company.name} title={application.title} stage={application.currentStage} revision={application.workflowRevision} checklist={parseWorkflowChecklist(application.workflowChecklist)} material={parseSubmissionPackage(application.submissionPackage)} attachments={application.attachments} />
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
      </div>

      <div id="interview-qa" className="scroll-mt-20">
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

      {/* Folded until there is an offer to compare — it is noise before that. */}
      {/* The anchor sits inside, so 「Offer」 in the section bar unfolds it. */}
      <details className="group rounded-xl border border-border/65 bg-card/60 open:border-transparent open:bg-transparent" open={offerStage || offerFilled}>
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold group-open:hidden">
          Offer 信息（薪资、通勤、加班、成长）<span className="ml-2 text-xs font-normal text-muted-foreground">拿到 Offer 后再填，点开展开</span>
        </summary>
        <div id="offer" className="scroll-mt-20">
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
      </details>
    </div>
  );
}
