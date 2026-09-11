import { z } from "zod";
import { db } from "@/lib/db";

// Shared shapes for 简历深挖模拟 — the actions in src/lib/actions/resume-drill.ts
// write these, the /resume-drill page reads them. Lives outside the "use
// server" file so the page-side loader isn't exposed as a callable action.

const drillQuestionSchema = z.object({
  id: z.string(),
  level: z.number().int().min(1).max(3),
  question: z.string(),
  intent: z.string(),
  keyPoints: z.array(z.string()),
});

const drillProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  questions: z.array(drillQuestionSchema),
});

export const drillTreeSchema = z.object({
  projects: z.array(drillProjectSchema),
});

const drillAnswerSchema = z.object({
  answer: z.string(),
  score: z.number().min(0).max(10),
  feedback: z.string(),
  betterAnswer: z.string(),
  followUp: z.string(),
  answeredAt: z.string(),
});

export type DrillQuestion = z.infer<typeof drillQuestionSchema>;
export type DrillProject = z.infer<typeof drillProjectSchema>;
export type DrillTree = z.infer<typeof drillTreeSchema>;
export type DrillAnswer = z.infer<typeof drillAnswerSchema>;

export type ResumeDrillDTO = {
  id: string;
  resumeVersionId: string;
  positionId: string | null;
  positionLabel: string | null;
  tree: DrillTree;
  answers: Record<string, DrillAnswer>;
  updatedAt: string;
};

export function parseAnswers(raw: unknown): Record<string, DrillAnswer> {
  const parsed = z.record(z.string(), drillAnswerSchema).safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Server-side read for the page — not an action, just shares the parsers. */
export async function loadResumeDrill(
  userId: string,
  resumeVersionId: string
): Promise<ResumeDrillDTO | null> {
  const drill = await db.resumeDrill.findFirst({
    where: { userId, resumeVersionId },
    include: { position: { include: { company: true } } },
  });
  if (!drill) return null;
  const tree = drillTreeSchema.safeParse(drill.tree);
  if (!tree.success) return null;
  return {
    id: drill.id,
    resumeVersionId: drill.resumeVersionId,
    positionId: drill.positionId,
    positionLabel: drill.position ? `${drill.position.company.name} · ${drill.position.title}` : null,
    tree: tree.data,
    answers: parseAnswers(drill.answers),
    updatedAt: drill.updatedAt.toISOString(),
  };
}
