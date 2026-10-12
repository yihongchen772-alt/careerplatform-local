import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { BackLink } from "@/components/ui/back-link";
import { STAGE_LABELS, AUTO_NOTE_PREFIXES } from "@/lib/stage-labels";
import { parseSubmissionPackage } from "@/lib/submission-package";
import { parseInterviewBrief } from "@/lib/interview-brief";
import { loadApplicationSchedule } from "@/lib/schedule-loader";
import { currentTimeMs } from "@/lib/dates";
import { isUpcoming } from "@/lib/interview-schedule";
import { BriefView } from "@/components/applications/brief-view";
import type { InterviewQa } from "@/lib/validation";

/**
 * 面试速览: one page to read before an interview. The parts that need no AI
 * (time and meeting, your own 面经 here, predicted questions, the JD) are
 * always shown; the AI summary is written on request and kept.
 */
export default async function InterviewBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const now = currentTimeMs();
  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    include: { company: true, position: { select: { jdText: true } }, interviewQA: true, interviewBrief: true, resumeVersion: { select: { id: true, name: true } } },
  });
  if (!application) notFound();
  const [resumes, notes, schedule] = await Promise.all([
    db.resumeVersion.findMany({ where: { userId: user.id }, select: { id: true, name: true, isDefault: true }, orderBy: { createdAt: "desc" } }),
    db.stageHistory.findMany({
      where: { application: { userId: user.id, companyId: application.companyId }, note: { not: null }, AND: AUTO_NOTE_PREFIXES.map((prefix) => ({ NOT: { note: { startsWith: prefix } } })) },
      select: { id: true, stage: true, stageLabel: true, note: true, enteredAt: true, application: { select: { id: true, title: true } } },
      orderBy: { enteredAt: "desc" },
      take: 10,
    }),
    loadApplicationSchedule(user.id, id, new Date(now)),
  ]);
  const next = schedule.items.find((item) => isUpcoming(item, now, 3650)) ?? null;
  const qa = application.interviewQA ? (application.interviewQA.content as InterviewQa) : null;
  const jd = application.position?.jdText || parseSubmissionPackage(application.submissionPackage)?.jd || "";
  const brief = application.interviewBrief ? parseInterviewBrief(application.interviewBrief.content) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5 print:max-w-none">
      <div className="print:hidden"><BackLink href={`/applications/${application.id}#interview`} label="返回这条投递" /></div>
      <BriefView
        applicationId={application.id}
        companyName={application.company.name}
        title={application.title}
        round={application.currentStageLabel || STAGE_LABELS[application.currentStage]}
        next={next}
        now={now}
        brief={brief}
        updatedAt={application.interviewBrief?.updatedAt.toISOString() ?? null}
        resumes={resumes.map((resume) => ({ id: resume.id, name: resume.name }))}
        defaultResumeId={application.resumeVersion?.id ?? resumes.find((resume) => resume.isDefault)?.id ?? resumes[0]?.id ?? null}
        notes={notes.map((note) => ({ id: note.id, round: note.stageLabel || STAGE_LABELS[note.stage], note: note.note ?? "", date: note.enteredAt.toISOString(), applicationId: note.application.id, title: note.application.title }))}
        questions={qa ? qa.questions.slice(0, 8).map((q) => ({ question: q.question, hint: q.tips || q.referenceAnswer })) : []}
        jd={jd}
      />
    </div>
  );
}
