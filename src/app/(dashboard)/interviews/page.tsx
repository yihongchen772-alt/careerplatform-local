import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AUTO_NOTE_PREFIXES } from "@/lib/stage-labels";
import type { ApplicationStage } from "@prisma/client";

// Rounds whose notes are 面经; 未通过 and Offer often carry the round's feedback too.
const INTERVIEW_LIBRARY_STAGES: ApplicationStage[] = ["ASSESSMENT", "OA", "AI_INTERVIEW", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER", "REJECTED"];
import {
  InterviewNotes,
  type InterviewNote,
} from "@/components/interviews/interview-notes";
import { InterviewIntelligenceCard } from "@/components/interviews/interview-intelligence-card";
import type { ExtractedQuestion } from "@/lib/actions/interview-note-extract";
import type { InterviewIntelligence } from "@/lib/actions/interview-intelligence";
import { PageHero } from "@/components/layout/page-hero";
import { BookOpen } from "lucide-react";

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const user = await requireUser();
  const { company } = await searchParams;

  const [histories, intelligence] = await Promise.all([
    db.stageHistory.findMany({
      where: {
        application: { userId: user.id },
        // A stage row only belongs in the library if it carries something worth
        // re-reading — a bare "moved to 一面" entry would just be noise, and
        // so is the App's own note on a step it recorded from a mail or the
        // portal (until the user writes their own over it).
        // 面经: a 测评 / 笔试 / 面试 round with a note, or any row that names
        // who interviewed or how. A note on 已投递 or 本人拒绝 is not one.
        OR: [
          { note: { not: null }, stage: { in: INTERVIEW_LIBRARY_STAGES } },
          { interviewer: { not: null } },
          { interviewFormat: { not: null } },
        ],
        AND: AUTO_NOTE_PREFIXES.map((prefix) => ({ OR: [{ note: null }, { NOT: { note: { startsWith: prefix } } }] })),
      },
      include: {
        application: { include: { company: true } },
        noteExtract: { select: { questions: true } },
      },
      orderBy: { enteredAt: "desc" },
    }),
    db.interviewIntelligence.findUnique({
      where: { userId: user.id },
      select: { result: true },
    }),
  ]);

  const notes: InterviewNote[] = histories.map((h) => ({
    id: h.id,
    stage: h.stage,
    enteredAt: h.enteredAt.toISOString(),
    note: h.note,
    interviewFormat: h.interviewFormat,
    interviewer: h.interviewer,
    applicationId: h.applicationId,
    companyName: h.application.company.name,
    title: h.application.title,
    extractedQuestions: (h.noteExtract?.questions as ExtractedQuestion[] | undefined) ?? null,
  }));

  return (
    <div className="space-y-6">
      <PageHero title="面经库" icon={BookOpen} description="汇总所有投递里写过的面试复盘，面试前可以按公司或阶段翻一遍" />
      <InterviewIntelligenceCard
        initial={intelligence ? (intelligence.result as InterviewIntelligence) : null}
      />
      <InterviewNotes key={company ?? ""} notes={notes} initialCompany={company?.trim() || null} />
    </div>
  );
}
