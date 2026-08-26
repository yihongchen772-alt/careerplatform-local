/**
 * Plain module, deliberately not "use server" — the schema and the export
 * format are needed on both sides, and a "use server" file may only export
 * async functions.
 */
import { z } from "zod";

export const questionBankItemSchema = z.object({
  question: z.string().min(1),
  /** Interview-question *type* (项目经历 / 计算机基础 / 行为面试...) — set by
   * the AI when a bank is generated from a specific application's Q&A. */
  category: z.string().nullish(),
  /** Technical *subject module* (C++ / Python / 大模型 / 嵌入式 / 强化学习 /
   * 具身智能...) — orthogonal to category. A question bank swept together
   * from months of practice needs this to stay usable; without it, "复习一下
   * C++" means scrolling past two hundred unrelated questions. Free text
   * rather than a fixed enum, since the right module set is different for
   * every candidate's track. */
  module: z.string().nullish(),
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

  // "# C++" style headings switch the module for every question below them,
  // until the next heading. Study notes are routinely organized exactly
  // this way, and recognizing it means a well-organized paste groups itself
  // instead of landing in one flat undifferentiated list.
  let currentModule: string | null = null;
  const questions: QuestionBankItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,3}\s*(.+)$/);
    if (heading) {
      currentModule = heading[1].trim() || null;
      continue;
    }

    const question = line
      // Strip the numbering these lists always carry: "1. ", "1、", "- ",
      // "Q1:" and so on, which would otherwise become part of the question.
      .replace(/^(\d+\s*[.、)．]|[-*•]|Q\d*\s*[:：])\s*/i, "")
      .trim();
    if (question.length < 4) continue;

    questions.push({ question, category: null, module: currentModule, referenceAnswer: null, tips: null });
    if (questions.length >= MAX_QUESTIONS) break;
  }

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
  let lastModule: string | null | undefined = undefined;
  bank.questions.forEach((q, i) => {
    if (q.module !== lastModule) {
      lines.push(`## ${q.module ?? "未分类"}`, "");
      lastModule = q.module;
    }
    lines.push(`### ${i + 1}. ${q.question}`);
    if (q.category) lines.push(`分类：${q.category}`);
    if (q.referenceAnswer) lines.push("", "**参考思路**", q.referenceAnswer);
    if (q.tips) lines.push("", `**提示**：${q.tips}`);
    lines.push("");
  });
  return lines.join("\n");
}
