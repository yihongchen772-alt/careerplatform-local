import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const applicationDraftSchema = z.object({
  contextKey: z.string().min(1).max(16384),
  url: z.string().url().max(16384).refine((value) => { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password; }),
  name: z.string().max(200).default("网申填写草稿"),
  fields: z.array(z.object({ label: z.string().max(500), fieldKey: z.string().max(2000).optional(), section: z.string().max(200).optional(), value: z.string().max(20000), ref: z.string().max(3000).optional(), selected: z.boolean().optional(), remember: z.boolean().optional(), edited: z.boolean().optional(), captured: z.boolean().optional() })).max(250),
  resumeVersionId: z.string().max(100).nullish(),
  variantId: z.string().max(100).nullish(),
  positionId: z.string().max(100).nullish(),
});
export type ApplicationDraftInput = z.infer<typeof applicationDraftSchema>;

export function applicationDraftKey(input: Omit<ApplicationDraftInput, "fields" | "name">) {
  return `${input.contextKey}|draft:v2:${createHash("sha256").update(JSON.stringify([input.url, input.resumeVersionId || "", input.variantId || ""])).digest("hex")}`;
}

export function safeDraftFields(fields: ApplicationDraftInput["fields"]) {
  return fields.filter((field) => !/密码|验证码|身份证|证件|银行卡|护照|password|captcha|passport|social security|bank account/i.test(field.label) && !/\d{17}[\dXx]/.test(field.value));
}

export async function storeApplicationDraft(tx: Prisma.TransactionClient, userId: string, input: ApplicationDraftInput) {
  const key = applicationDraftKey(input);
  const existing = await tx.applicationDraft.findUnique({ where: { userId_contextKey: { userId, contextKey: key } } });
  const previous = existing?.content as { fields?: ApplicationDraftInput["fields"]; capturedFields?: ApplicationDraftInput["fields"]; previewFields?: ApplicationDraftInput["fields"] } | undefined;
  const fieldKey = (field: ApplicationDraftInput["fields"][number]) => field.fieldKey || `${field.section}|${field.label}`;
  // Keep both layers. Scanning an untouched empty webpage must not erase
  // an edit still in the preview; actual typing takes priority on restore.
  const captured = new Map((previous?.capturedFields || previous?.fields?.filter((field) => field.captured) || []).map((field) => [fieldKey(field), field]));
  const preview = new Map((previous?.previewFields || previous?.fields?.filter((field) => !field.captured) || []).map((field) => [fieldKey(field), field]));
  for (const field of safeDraftFields(input.fields)) {
    // Reloading a blank form is not an intentional clear. Keep the last
    // filled value until the applicant types/clears or enters a new value.
    if (field.captured && !field.edited && !field.value.trim() && captured.get(fieldKey(field))?.value.trim()) continue;
    (field.captured ? captured : preview).set(fieldKey(field), field);
  }
  const fields = [...new Set([...captured.keys(), ...preview.keys()])].map((key) => {
    const actual = captured.get(key);
    return actual && (actual.edited || actual.value.trim() || !preview.has(key)) ? actual : preview.get(key)!;
  });
  const content = { ...input, fields: fields.slice(0, 250), capturedFields: [...captured.values()].slice(0, 250), previewFields: [...preview.values()].slice(0, 250) };
  const data = { url: input.url, name: input.name, content };
  await tx.applicationDraft.upsert({ where: { userId_contextKey: { userId, contextKey: key } }, create: { userId, contextKey: key, ...data }, update: data });
}
