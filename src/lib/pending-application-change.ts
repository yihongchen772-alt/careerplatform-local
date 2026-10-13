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

/** Pending changes nobody looked at for this long drop out of 待核对. */
export const PENDING_VISIBLE_DAYS = 14;

/** What 待核对 lists: pending and touched within the last two weeks. */
export function visiblePendingWhere(userId: string, now = new Date()) {
  return { userId, status: "pending", updatedAt: { gte: new Date(now.getTime() - PENDING_VISIBLE_DAYS * 86_400_000) } };
}

const PROFILE_FIELD = /姓名|名字|手机|电话|联系方式|邮箱|电子邮件|e-?mail|性别|出生|生日|年龄|籍贯|户籍|户口|民族|政治面貌|微信|通讯地址|通信地址|联系地址|家庭住址|邮寄地址|现住|居住|所在地|所在城市|现居|院系|学院|学校|专业|学历|学位|绩点|gpa|英语|外语|语种|期望薪|期望年薪|期望月薪|到岗|入职时间|实习时长|身高|体重|邮编|证件|身份证|^name$|phone|mobile|address|city|country|nationality/i;
const THIRD_PARTY = /紧急|家庭成员|家属|父亲|母亲|配偶|推荐人|内推人|联系人|监护人|emergency|reference|referee/i;
const SEARCH_BOX = /关键字|关键词|搜索|检索|筛选|search|filter|keyword/i;
const DATE_PART = /^(?:day|month|year|日|月|年|日期|时间|date|time)\*?$/i;

/**
 * Captures not worth a review: fields the 网申资料 already fills (an edit
 * there is reformatting), other people's details, a site's search box,
 * one part of a split date, a dialling code, an internal field name. These
 * made up most of what applicants ignored.
 */
export function isNoiseAnswer(answer: { questionLabel: string; answer: string; kind?: string }): boolean {
  const label = answer.questionLabel.replace(/[\s*＊:：]/g, "");
  const value = answer.answer.trim();
  if (!label || !value) return true;
  // A site's own spelling of the first school / major / degree is learned on purpose.
  if (answer.kind === "field" && ["学校", "专业", "学历"].includes(label)) return false;
  if (SEARCH_BOX.test(label) || DATE_PART.test(label) || THIRD_PARTY.test(label)) return true;
  if (/^\+?\d{1,4}$/.test(label) || /^\+\d{1,4}$/.test(value)) return true;
  // camelCase / snake_case names straight from the page source.
  if (/^[A-Za-z][A-Za-z0-9]*(?:[A-Z_][A-Za-z0-9]*)+$/.test(label) && label.length >= 8) return true;
  // Profile fields are filled from 网申资料, not remembered as answers —
  // long free-text answers that only mention one of these words stay.
  if (answer.kind !== "essay" && PROFILE_FIELD.test(label) && label.length <= 16) return true;
  return false;
}

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
    ...input.answers.filter((answer) => !isNoiseAnswer(answer)).map((answer) => ({ kind: "answer" as const, label: answer.questionLabel, payload: answer })),
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
      // The same internship / project / award as one in 网申资料 is already
      // known, even worded a little differently: 网申资料 is where it is kept.
      alreadyKnown = profile[list].some((current) => sameMemoryEntity(record.category, current, record.content)) || memories.some((current) => current.category === record.category && [current.content, ...(Array.isArray(current.alternatives) ? current.alternatives.map((item) => (item as { content: MemoryContent }).content) : [])].some((content) => sameMemoryEntity(record.category, content as MemoryContent, record.content) && recordContains(content as MemoryContent, record.content)));
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
