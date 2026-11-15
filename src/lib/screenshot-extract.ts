import type { ApplicationStage } from "@prisma/client";
import { z } from "zod";
import type { GeminiSchema } from "@/lib/gemini";

export const SCREENSHOT_KINDS = [
  "exam",
  "interview",
  "confirmation",
  "offer",
  "rejection",
  "notice",
  "other",
] as const;

export type ScreenshotKind = (typeof SCREENSHOT_KINDS)[number];

export const SCREENSHOT_STAGES = [
  "APPLIED",
  "SCREENING",
  "ASSESSMENT",
  "OA",
  "AI_INTERVIEW",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "INTERVIEW_3",
  "HR_INTERVIEW",
  "OFFER",
  "REJECTED",
] as const satisfies readonly ApplicationStage[];

export const screenshotExtractionSchema = z.object({
  kind: z.enum(SCREENSHOT_KINDS).default("other"),
  companyName: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  summary: z.string().trim().max(400).default(""),
  startsAt: z.string().trim().max(64).nullable().optional(),
  endsAt: z.string().trim().max(64).nullable().optional(),
  hasTime: z.boolean().default(false),
  entryUrl: z.string().trim().max(2000).nullable().optional(),
  accessCode: z.string().trim().max(160).nullable().optional(),
  suggestedStage: z.enum(SCREENSHOT_STAGES).nullable().optional(),
});

export type ScreenshotExtraction = {
  kind: ScreenshotKind;
  companyName: string | null;
  title: string | null;
  summary: string;
  startsAt: string | null;
  endsAt: string | null;
  hasTime: boolean;
  entryUrl: string | null;
  accessCode: string | null;
  suggestedStage: (typeof SCREENSHOT_STAGES)[number] | null;
};

export const SCREENSHOT_GEMINI_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: [...SCREENSHOT_KINDS] },
    companyName: { type: "STRING", nullable: true },
    title: { type: "STRING", nullable: true },
    summary: { type: "STRING" },
    startsAt: { type: "STRING", nullable: true },
    endsAt: { type: "STRING", nullable: true },
    hasTime: { type: "BOOLEAN" },
    entryUrl: { type: "STRING", nullable: true },
    accessCode: { type: "STRING", nullable: true },
    suggestedStage: { type: "STRING", enum: [...SCREENSHOT_STAGES], nullable: true },
  },
  required: ["kind", "companyName", "title", "summary", "startsAt", "endsAt", "hasTime", "entryUrl", "accessCode", "suggestedStage"],
};

export function normalizeScreenshotUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function parseScreenshotDate(raw: string | null | undefined, hasTime: boolean): Date | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!hasTime) {
    const dateOnly = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
    if (dateOnly) {
      const y = dateOnly[1];
      const m = dateOnly[2].padStart(2, "0");
      const d = dateOnly[3].padStart(2, "0");
      const parsed = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  const normalized = value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseScreenshotExtraction(raw: unknown): ScreenshotExtraction | null {
  const parsed = screenshotExtractionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;
  const startDate = parseScreenshotDate(data.startsAt, data.hasTime);
  const endDate = parseScreenshotDate(data.endsAt, data.hasTime);
  return {
    kind: data.kind,
    companyName: data.companyName || null,
    title: data.title || null,
    summary: data.summary || "已读取页面截图内容",
    startsAt: startDate ? (data.hasTime ? startDate.toISOString() : startDate.toISOString().slice(0, 10)) : null,
    endsAt: endDate ? (data.hasTime ? endDate.toISOString() : endDate.toISOString().slice(0, 10)) : null,
    hasTime: !!startDate && data.hasTime,
    entryUrl: normalizeScreenshotUrl(data.entryUrl),
    accessCode: data.accessCode || null,
    suggestedStage: data.suggestedStage ?? null,
  };
}

export function buildScreenshotMeetingInfo(extraction: Pick<ScreenshotExtraction, "entryUrl" | "accessCode" | "summary">): string | null {
  const parts = [
    extraction.entryUrl || null,
    extraction.accessCode ? `口令/编号：${extraction.accessCode}` : null,
    extraction.summary || null,
  ].filter(Boolean);
  const joined = parts.join(" · ").trim().slice(0, 2000);
  return joined || null;
}

export function resolveScreenshotTargetStage(
  currentStage: ApplicationStage,
  extraction: Pick<ScreenshotExtraction, "kind"> & { suggestedStage?: ApplicationStage | null }
): ApplicationStage {
  if (extraction.suggestedStage) return extraction.suggestedStage;
  switch (extraction.kind) {
    case "exam":
      return "OA";
    case "interview":
      return currentStage === "INTERVIEW_1" ? "INTERVIEW_2" : currentStage === "INTERVIEW_2" ? "INTERVIEW_3" : "INTERVIEW_1";
    case "offer":
      return "OFFER";
    case "rejection":
      return "REJECTED";
    default:
      return currentStage;
  }
}

export function matchApplicationForScreenshot<T extends { id: string; companyName: string; label: string }>(
  applications: T[],
  companyName: string | null | undefined,
  pageTitle?: string | null
): T | undefined {
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const targetCompany = companyName ? norm(companyName) : "";
  if (targetCompany.length >= 2) {
    const byExtracted = applications.find((a) => {
      const c = norm(a.companyName);
      return c.length >= 2 && (targetCompany.includes(c) || c.includes(targetCompany));
    });
    if (byExtracted) return byExtracted;
  }
  const title = pageTitle ? norm(pageTitle) : "";
  if (title.length >= 2) {
    return applications.find((a) => a.companyName && title.includes(norm(a.companyName)));
  }
  return undefined;
}
