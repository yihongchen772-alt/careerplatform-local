import { z } from "zod";
export const submissionSnapshotSchema = z.object({
  url: z.string().url().max(16384).refine((v) => /^https?:\/\//i.test(v)),
  // Trimmed, never refused: a long form or a long label must not cost the applicant the whole 材料包.
  fields: z.array(z.object({ label: z.unknown().optional().transform((v) => String(v ?? "").slice(0, 200)), value: z.unknown().optional().transform((v) => String(v ?? "").slice(0, 20000)) })).transform((list) => list.slice(0, 250)),
  resumeVersionId: z.string().max(100).optional(), variantId: z.string().max(100).optional(), positionId: z.string().max(100).optional(),
});
export type SubmissionPackage = { confirmedAt: string; pageUrl: string; company: string; title: string; jd: string; profile: unknown; variant: string; resumeName: string; resumeAttachmentId: string | null; fields: { label: string; value: string }[] };
export function parseSubmissionPackage(value: unknown): SubmissionPackage | null {
  const parsed = z.object({ confirmedAt: z.string().datetime(), pageUrl: z.string(), company: z.string(), title: z.string(), jd: z.string(), profile: z.unknown(), variant: z.string(), resumeName: z.string(), resumeAttachmentId: z.string().nullable(), fields: submissionSnapshotSchema.shape.fields }).safeParse(value);
  return parsed.success ? { ...parsed.data, profile: parsed.data.profile } : null;
}
export function safeSubmissionFields(fields: { label: string; value: string }[]) {
  return fields.filter((f) => !/密码|验证码|证件|身份证|银行卡|护照|家庭住址|password|captcha|passport|social security|bank account/i.test(f.label) && !/\d{17}[\dXx]/.test(f.value));
}
