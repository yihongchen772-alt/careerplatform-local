/**
 * Plain module, deliberately not "use server" — the schema and the export
 * format are needed on both sides, and a "use server" file may only export
 * async functions.
 */
import { z } from "zod";

export const questionBankItemSchema = z.object({
  question: z.string().min(1),
  category: z.string().nullish(),
  referenceAnswer: z.string().nullish(),
  tips: z.string().nullish(),
});

export type QuestionBankItem = z.infer<typeof questionBankItemSchema>;

/**
 * The on-disk exchange format. Versioned from the start because these files
 * are meant to be passed between people (and between installs) — an
 * unversioned blob would leave no way to tell a future format change from a
 * corrupt file.
 */
export const BANK_FILE_VERSION = 1;

export const bankFileSchema = z.object({
  version: z.number(),
  name: z.string().min(1),
  source: z.string().nullish(),
  questions: z.array(questionBankItemSchema).min(1),
});

export type BankFile = z.infer<typeof bankFileSchema>;

export const MAX_QUESTIONS = 200;

/**
 * Parses either an exported .json bank or a plain list of questions, one per
 * line. The plain-text path exists because that is how question banks
 * actually circulate — pasted into a group chat, not exported from an app —
 * and refusing to read them would make the import button useless for the
 * most common case.
 */
export function parseBankInput(raw: string): { name?: string; source?: string; questions: QuestionBankItem[] } | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith("{")) {
    try {
      const parsed = bankFileSchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        return {
          name: parsed.data.name,
          source: parsed.data.source ?? undefined,
          questions: parsed.data.questions.slice(0, MAX_QUESTIONS),
        };
      }
    } catch {
      // Fall through to the line-based reading below — a JSON-looking blob
      // that doesn't parse is more likely a pasted fragment than a bank.
    }
  }

  const questions = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        // Strip the numbering these lists always carry: "1. ", "1、", "- ",
        // "Q1:" and so on, which would otherwise become part of the question.
        .replace(/^(\d+\s*[.、)．]|[-*•]|Q\d*\s*[:：])\s*/i, "")
        .trim()
    )
    .filter((line) => line.length >= 4)
    .slice(0, MAX_QUESTIONS)
    .map((question) => ({ question, category: null, referenceAnswer: null, tips: null }));

  return questions.length > 0 ? { questions } : null;
}

/** The bank as a downloadable file body. */
export function toBankFile(bank: {
  name: string;
  source?: string | null;
  questions: QuestionBankItem[];
}): string {
  const payload: BankFile = {
    version: BANK_FILE_VERSION,
    name: bank.name,
    source: bank.source ?? null,
    questions: bank.questions,
  };
  return JSON.stringify(payload, null, 2);
}

/** Human-readable export, for pasting back into a group chat. */
export function toBankMarkdown(bank: {
  name: string;
  source?: string | null;
  questions: QuestionBankItem[];
}): string {
  const lines = [`# ${bank.name}`, ""];
  if (bank.source) lines.push(`来源：${bank.source}`, "");
  bank.questions.forEach((q, i) => {
    lines.push(`## ${i + 1}. ${q.question}`);
    if (q.category) lines.push(`分类：${q.category}`);
    if (q.referenceAnswer) lines.push("", "**参考思路**", q.referenceAnswer);
    if (q.tips) lines.push("", `**提示**：${q.tips}`);
    lines.push("");
  });
  return lines.join("\n");
}
