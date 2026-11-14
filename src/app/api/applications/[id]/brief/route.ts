import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { inferBriefMode, parseInterviewBrief } from "@/lib/interview-brief";
import { AUTO_NOTE_PREFIXES, STAGE_LABELS } from "@/lib/stage-labels";
import type { InterviewQa } from "@/lib/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    include: {
      company: { select: { name: true } },
      interviewBrief: true,
      interviewQA: true,
    },
  });
  if (!application) {
    return NextResponse.json({ error: "未找到这条投递记录" }, { status: 404 });
  }
  const [sameCompanyNotes, resumes] = await Promise.all([
    db.stageHistory.findMany({
      where: {
        application: { userId: user.id, companyId: application.companyId },
        note: { not: null },
        AND: AUTO_NOTE_PREFIXES.map((prefix) => ({ NOT: { note: { startsWith: prefix } } })),
      },
      orderBy: { enteredAt: "desc" },
      take: 8,
      select: {
        id: true,
        stage: true,
        stageLabel: true,
        note: true,
        enteredAt: true,
        application: { select: { title: true } },
      },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const notes = sameCompanyNotes.map((n) => ({
    id: n.id,
    round: n.stageLabel?.trim() || STAGE_LABELS[n.stage],
    note: n.note ?? "",
    date: n.enteredAt.toISOString(),
    title: n.application.title,
  }));
  const qa = application.interviewQA ? (application.interviewQA.content as InterviewQa) : null;
  const questions = qa?.questions?.slice(0, 8).map((q) => ({ question: q.question, hint: q.tips || q.referenceAnswer })) ?? [];
  const defaultResumeId =
    application.resumeVersionId ?? resumes.find((r) => r.isDefault)?.id ?? resumes[0]?.id ?? null;
  return NextResponse.json({
    applicationId: application.id,
    companyName: application.company.name,
    title: application.title,
    defaultMode: inferBriefMode(application.currentStage, application.currentStageLabel),
    resumes: resumes.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault })),
    defaultResumeId,
    brief: application.interviewBrief ? parseInterviewBrief(application.interviewBrief.content) : null,
    updatedAt: application.interviewBrief?.updatedAt.toISOString() ?? null,
    notes,
    questions,
  });
}
