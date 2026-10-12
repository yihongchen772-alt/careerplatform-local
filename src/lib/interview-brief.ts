import { z } from "zod";

/**
 * 面试速览, the AI half: what this interview will most likely test, which of
 * the applicant's own experiences answer it, likely questions, questions to
 * ask back and a few reminders. Lives outside the "use server" action file
 * because a zod object cannot be exported from one.
 */
export const interviewBriefSchema = z.object({
  summary: z.string(),
  focus: z.array(z.object({ point: z.string(), why: z.string() })).max(8),
  stories: z.array(z.object({ point: z.string(), experience: z.string(), howToTell: z.string() })).max(8),
  questions: z.array(z.object({ question: z.string(), hint: z.string() })).max(10),
  askBack: z.array(z.string()).max(6),
  reminders: z.array(z.string()).max(6),
});

export type InterviewBrief = z.infer<typeof interviewBriefSchema>;

export const interviewBriefAiSchema = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    focus: { type: "ARRAY", items: { type: "OBJECT", properties: { point: { type: "STRING" }, why: { type: "STRING" } }, required: ["point", "why"] } },
    stories: { type: "ARRAY", items: { type: "OBJECT", properties: { point: { type: "STRING" }, experience: { type: "STRING" }, howToTell: { type: "STRING" } }, required: ["point", "experience", "howToTell"] } },
    questions: { type: "ARRAY", items: { type: "OBJECT", properties: { question: { type: "STRING" }, hint: { type: "STRING" } }, required: ["question", "hint"] } },
    askBack: { type: "ARRAY", items: { type: "STRING" } },
    reminders: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "focus", "stories", "questions", "askBack", "reminders"],
} as const;

/** Lenient read of what the model sent back: over-long lists are cut, not rejected. */
export function parseInterviewBrief(raw: unknown): InterviewBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const list = (key: string, max: number) => (Array.isArray(value[key]) ? (value[key] as unknown[]).slice(0, max) : []);
  const parsed = interviewBriefSchema.safeParse({
    summary: typeof value.summary === "string" ? value.summary : "",
    focus: list("focus", 8),
    stories: list("stories", 8),
    questions: list("questions", 10),
    askBack: list("askBack", 6),
    reminders: list("reminders", 6),
  });
  return parsed.success && (parsed.data.summary || parsed.data.questions.length) ? parsed.data : null;
}
