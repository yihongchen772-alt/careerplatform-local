import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { MEMORY_CATEGORIES, memoryContent, normalizeMemoryText, type MemoryCapture } from "@/lib/application-memory";

export type PendingAnswer = {
  questionLabel: string;
  answer: string;
  answerId?: string;
  kind: "essay" | "short" | "field";
};

export type PendingApplicationChangeView = {
  id: string;
  kind: "answer" | "record";
  label: string;
  payload: PendingAnswer | MemoryCapture;
  sourceUrl: string;
  contextKey: string | null;
  createdAt: string;
};

function fingerprint(kind: string, payload: unknown, contextKey: string | null) {
  return createHash("sha256").update(JSON.stringify([kind, contextKey, payload])).digest("hex");
}

export async function stageApplicationChanges(
  tx: Prisma.TransactionClient,
  userId: string,
  input: { answers: PendingAnswer[]; records: MemoryCapture[]; sourceUrl: string; contextKey: string | null; resumeVersionId?: string | null },
) {
  let staged = 0;
  const rows: Array<{ kind: "answer" | "record"; label: string; payload: PendingAnswer | MemoryCapture }> = [
    ...input.answers.map((answer) => ({ kind: "answer" as const, label: answer.questionLabel, payload: answer })),
    ...input.records.map((record) => {
      const content = memoryContent(record.category, record.content)!;
      const title = content.name || content.company || content.school || MEMORY_CATEGORIES[record.category];
      return { kind: "record" as const, label: `${MEMORY_CATEGORIES[record.category]} · ${title}`, payload: { ...record, content } };
    }),
  ];
  for (const row of rows) {
    const normalized = row.kind === "answer"
      ? { questionLabel: normalizeMemoryText((row.payload as PendingAnswer).questionLabel), answer: (row.payload as PendingAnswer).answer.trim(), kind: (row.payload as PendingAnswer).kind }
      : { category: (row.payload as MemoryCapture).category, content: (row.payload as MemoryCapture).content };
    const key = fingerprint(row.kind, normalized, input.contextKey);
    const existing = await tx.pendingApplicationChange.findUnique({ where: { userId_fingerprint: { userId, fingerprint: key } }, select: { id: true } });
    if (existing) {
      await tx.pendingApplicationChange.update({ where: { id: existing.id }, data: { sourceUrl: input.sourceUrl, label: row.label, payload: row.payload, updatedAt: new Date() } });
    } else {
      await tx.pendingApplicationChange.create({ data: { userId, kind: row.kind, label: row.label, payload: row.payload, sourceUrl: input.sourceUrl, contextKey: input.contextKey, resumeVersionId: input.resumeVersionId ?? null, fingerprint: key } });
      staged++;
    }
  }
  return { staged, processed: rows.length };
}

export function toPendingApplicationChangeView(row: { id: string; kind: string; label: string; payload: unknown; sourceUrl: string; contextKey: string | null; createdAt: Date }): PendingApplicationChangeView {
  return { ...row, kind: row.kind as "answer" | "record", payload: row.payload as PendingAnswer | MemoryCapture, createdAt: row.createdAt.toISOString() };
}
