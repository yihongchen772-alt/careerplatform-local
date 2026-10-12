import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AUTO_NOTE_PREFIXES } from "@/lib/stage-labels";
import {
  InterviewNotes,
  type InterviewNote,
} from "@/components/interviews/interview-notes";
import { InterviewIntelligenceCard } from "@/components/interviews/interview-intelligence-card";
import type { ExtractedQuestion } from "@/lib/actions/interview-note-extract";
import type { InterviewIntelligence } from "@/lib/actions/interview-intelligence";

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
        OR: [
          { note: { not: null } },
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
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">面经库</h1>
        <p className="text-sm text-muted-foreground">
          汇总所有投递里写过的面试复盘，面试前可以按公司或阶段翻一遍
        </p>
      </div>
      <InterviewIntelligenceCard
        initial={intelligence ? (intelligence.result as InterviewIntelligence) : null}
      />
      <InterviewNotes key={company ?? ""} notes={notes} initialCompany={company?.trim() || null} />
    </div>
  );
}
