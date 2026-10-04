import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { MEMORY_CATEGORIES, memoryContent, memoryIdentity, memoryValueKey, normalizeMemoryText, sameMemoryEntity, type MemoryCapture, type MemoryContent } from "@/lib/application-memory";
import { parseApplicationProfile, resolveProfileVariant } from "@/lib/application-profile";

export type PendingAnswer = {
  questionLabel: string;
  answer: string;
  answerId?: string;
  fieldKey?: string;
  kind: "essay" | "short" | "field";
};

export type CaptureWithdrawal = { kind: "answer"; fieldKey: string } | { kind: "record"; category: MemoryCapture["category"]; captureKey: string };

export type PendingApplicationChangeView = {
  id: string;
  kind: "answer" | "record";
  label: string;
  payload: PendingAnswer | MemoryCapture;
  sourceUrl: string;
  contextKey: string | null;
  createdAt: string;
  revision: number;
};

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function captureValueKey(kind: string, payload: PendingAnswer | MemoryCapture): string {
  if (kind === "answer") {
    const answer = payload as PendingAnswer;
    return JSON.stringify([answer.kind, normalizeMemoryText(answer.questionLabel), memoryValueKey(answer.questionLabel === "出生日期" ? "date" : "answer", answer.answer)]);
  }
  const record = payload as MemoryCapture;
  return JSON.stringify([record.category, Object.entries(record.content).filter(([, value]) => value).map(([key, value]) => [key, memoryValueKey(key, value)]).sort(([a], [b]) => a.localeCompare(b))]);
}

export function recordContains(current: MemoryContent, incoming: MemoryContent) {
  return Object.entries(incoming).every(([key, value]) => !value || memoryValueKey(key, current[key] || "") === memoryValueKey(key, value));
}

export async function stageApplicationChanges(
  tx: Prisma.TransactionClient,
  userId: string,
  input: { answers: PendingAnswer[]; records: MemoryCapture[]; withdrawals?: CaptureWithdrawal[]; sourceUrl: string; contextKey: string | null; resumeVersionId?: string | null; variantId?: string | null },
) {
  let staged = 0;
  const scope = { userId, contextKey: input.contextKey, sourceUrl: input.sourceUrl, resumeVersionId: input.resumeVersionId || null, variantId: input.variantId || null };
  const pending = await tx.pendingApplicationChange.findMany({ where: scope });
  for (const withdrawal of input.withdrawals || []) {
    for (const item of pending.filter((item) => item.kind === withdrawal.kind && item.status === "pending")) {
      const payload = item.payload as PendingAnswer & MemoryCapture;
      if (withdrawal.kind === "answer" ? payload.fieldKey === withdrawal.fieldKey : payload.category === withdrawal.category && payload.captureKey === withdrawal.captureKey) {
        await tx.pendingApplicationChange.update({ where: { id: item.id }, data: { status: "withdrawn", revision: { increment: 1 } } });
      }
    }
  }
  const memories = await tx.applicationMemory.findMany({ where: { userId } });
  const confirmed = await tx.autofillAnswer.findMany({ where: { userId, confirmed: true, OR: [{ contextKey: input.contextKey }, { contextKey: null }] }, orderBy: { updatedAt: "desc" } });
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const { profile } = resolveProfileVariant(parseApplicationProfile(user.applicationProfile), input.variantId || undefined, input.resumeVersionId || undefined);
  const facts: Record<string, string | null> = { 姓名: user.name, 手机: user.phone, 邮箱: user.contactEmail, 性别: user.gender, 出生日期: user.birthDate, 学校: user.school, 专业: profile.education[0]?.major || null, 学历: profile.education[0]?.degree || null };
  const rows: Array<{ kind: "answer" | "record"; label: string; payload: PendingAnswer | MemoryCapture }> = [
    ...input.answers.map((answer) => ({ kind: "answer" as const, label: answer.questionLabel, payload: answer })),
    ...input.records.map((record) => {
      const content = memoryContent(record.category, record.content)!;
      const title = content.name || content.company || content.school || MEMORY_CATEGORIES[record.category];
      return { kind: "record" as const, label: `${MEMORY_CATEGORIES[record.category]} · ${title}`, payload: { ...record, content } };
    }),
  ];
  const slot = (kind: string, payload: PendingAnswer | MemoryCapture) => kind === "answer"
    ? [(payload as PendingAnswer).kind, (payload as PendingAnswer).fieldKey || normalizeMemoryText((payload as PendingAnswer).questionLabel)]
    : [(payload as MemoryCapture).category, (payload as MemoryCapture).captureKey || memoryIdentity((payload as MemoryCapture).category, (payload as MemoryCapture).content)];
  for (const row of rows) {
    const rowSlot = JSON.stringify(slot(row.kind, row.payload));
    const key = fingerprint([scope, row.kind, rowSlot]);
    const existing = pending.find((item) => item.fingerprint === key || (item.kind === row.kind && JSON.stringify(slot(item.kind, item.payload as PendingAnswer | MemoryCapture)) === rowSlot));
    const valueKey = captureValueKey(row.kind, row.payload);
    if (existing && existing.status !== "withdrawn" && captureValueKey(existing.kind, existing.payload as PendingAnswer | MemoryCapture) === valueKey) continue;
    let alreadyKnown = false;
    if (row.kind === "answer") {
      const answer = row.payload as PendingAnswer;
      const candidates = confirmed.filter((item) => item.kind === answer.kind && normalizeMemoryText(item.questionLabel) === normalizeMemoryText(answer.questionLabel));
      const preferred = candidates.find((item) => item.contextKey === input.contextKey) || candidates.find((item) => item.contextKey === null);
      alreadyKnown = preferred ? captureValueKey("answer", preferred as PendingAnswer) === valueKey
        : answer.kind === "field" && !!facts[answer.questionLabel] && memoryValueKey(answer.questionLabel === "出生日期" ? "date" : "answer", facts[answer.questionLabel]!) === memoryValueKey(answer.questionLabel === "出生日期" ? "date" : "answer", answer.answer);
    } else {
      const record = row.payload as MemoryCapture;
      const list = record.category === "experience" ? "experiences" : record.category === "project" ? "projects" : record.category === "award" ? "awards" : "education";
      alreadyKnown = profile[list].some((current) => sameMemoryEntity(record.category, current, record.content) && recordContains(current, record.content)) || memories.some((current) => current.category === record.category && [current.content, ...(Array.isArray(current.alternatives) ? current.alternatives.map((item) => (item as { content: MemoryContent }).content) : [])].some((content) => sameMemoryEntity(record.category, content as MemoryContent, record.content) && recordContains(content as MemoryContent, record.content)));
    }
    if (existing) {
      const updated = await tx.pendingApplicationChange.update({ where: { id: existing.id }, data: { label: row.label, payload: row.payload, fingerprint: key, status: alreadyKnown ? "accepted" : "pending", revision: { increment: 1 } } });
      pending[pending.indexOf(existing)] = updated;
      if (!alreadyKnown) staged++;
    } else if (!alreadyKnown) {
      pending.push(await tx.pendingApplicationChange.create({ data: { ...scope, kind: row.kind, label: row.label, payload: row.payload, fingerprint: key } }));
      staged++;
    }
  }
  return { staged, processed: rows.length };
}

export function toPendingApplicationChangeView(row: { id: string; kind: string; label: string; payload: unknown; sourceUrl: string; contextKey: string | null; createdAt: Date; revision: number }): PendingApplicationChangeView {
  return { id: row.id, kind: row.kind as "answer" | "record", label: row.label, payload: row.payload as PendingAnswer | MemoryCapture, sourceUrl: row.sourceUrl, contextKey: row.contextKey, createdAt: row.createdAt.toISOString(), revision: row.revision };
}
