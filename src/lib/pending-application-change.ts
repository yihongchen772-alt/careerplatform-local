import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { MEMORY_CATEGORIES, MEMORY_LISTS, memoryContent, memoryIdentity, memoryValueKey, normalizeMemoryText, sameMemoryEntity, type MemoryCapture, type MemoryContent } from "@/lib/application-memory";
import { parseApplicationProfile, resolveProfileVariant, type ApplicationProfile } from "@/lib/application-profile";
import { companySpecificQuestion } from "@/lib/autofill-answer-scope";
import { learnFromPage, profileKeyForLabel, LEARNABLE_FACTS, type LearnedNotice } from "@/lib/profile-learning";

export type PendingAnswer = {
  questionLabel: string;
  answer: string;
  answerId?: string;
  fieldKey?: string;
  kind: "essay" | "short" | "field";
  /** The 网申资料 field the page's label maps to, when it maps to one. */
  profileKey?: string;
};

export type CaptureWithdrawal = { kind: "answer"; fieldKey: string } | { kind: "record"; category: MemoryCapture["category"]; captureKey: string };

export type PendingEvaluation = {
  verdict: "add_new" | "upgrade_existing" | "company_specific" | "conflict_review";
  badge: string;
  reason: string;
  currentValue?: string;
  recommendedTarget: "profile" | "custom_field" | "resume_template" | "memory_local" | "memory_global";
};

export type PendingApplicationChangeView = {
  id: string;
  kind: "answer" | "record";
  label: string;
  payload: PendingAnswer | MemoryCapture;
  sourceUrl: string;
  contextKey: string | null;
  createdAt: string;
  revision: number;
  /** For a short answer that is a 网申资料 field: which one (研究方向 …). */
  profileField?: { key: string; label: string };
  /** Smart assessment of whether/how this hand-typed capture should update profile or resume template. */
  evaluation?: PendingEvaluation;
};

/** Pending changes nobody looked at for this long drop out of 待核对. */
export const PENDING_VISIBLE_DAYS = 14;

/** What 待核对 lists: pending and touched within the last two weeks. */
export function visiblePendingWhere(userId: string, now = new Date()) {
  return { userId, status: "pending", updatedAt: { gte: new Date(now.getTime() - PENDING_VISIBLE_DAYS * 86_400_000) } };
}

const PROFILE_FIELD = /姓名|名字|手机|电话|联系方式|邮箱|电子邮件|e-?mail|性别|出生|生日|年龄|籍贯|户籍|户口|民族|政治面貌|微信|^地址$|通讯地址|通信地址|联系地址|家庭住址|邮寄地址|期望(?:工作)?(?:地点|城市)|现住|居住|所在地|所在城市|现居|院系|学院|学校|专业|学历|学位|绩点|gpa|英语|外语|语种|期望薪|期望年薪|期望月薪|到岗|入职时间|实习时长|身高|体重|邮编|证件|身份证|^name$|phone|mobile|address|city|country|nationality/i;
const THIRD_PARTY = /紧急|家庭成员|家属|父亲|母亲|配偶|推荐人|内推人|联系人|监护人|emergency|reference|referee/i;
const SEARCH_BOX = /关键字|关键词|搜索|检索|筛选|search|filter|keyword/i;
const DATE_PART = /^(?:day|month|year|日|月|年|日期|时间|date|time)\*?$/i;
// One field of an 经历 / 技能 block: the block is captured whole as a record,
// its parts on their own are just fragments ("职位名称", "工作职责" ×4).
const BLOCK_PART = /^(?:(?:在校|担任|所任|所在)?(?:职位|职务|岗位|角色|单位|公司|企业|组织|部门|实验室|社团|学校|院校|专业|项目|奖项|荣誉|证书|技能|语种|课程)(?:名称|名)?|(?:工作|项目|实习|实践|活动)(?:职责|内容|描述|成果|业绩)|(?:掌握|熟练|精通)?程度|(?:起止|开始|结束|入职|离职)(?:时间|日期|年月)|担任职务|所在组织|证明人|第\s*\d+\s*志愿)$/;
// What a page shows inside or next to a box, not a question: "113/2000", "请输入职位名称", "点击选择其他".
const NOT_A_LABEL = /^(?:\d+\s*\/\s*\d+|(?:请|点击|点此|选择|输入)\S*)$/;
// Pages where typing is about the account, not the application.
export const ACCOUNT_PAGE = /login|signin|sign-in|signup|sign-up|register|passport|sso|account|登录|注册/i;

/**
 * Captures not worth a review: fields the 网申资料 already fills (an edit
 * there is reformatting), other people's details, a site's search box,
 * one part of a split date, a dialling code, an internal field name. These
 * made up most of what applicants ignored.
 */
export function isNoiseAnswer(answer: { questionLabel: string; answer: string; kind?: string; profileKey?: string }, sourceUrl = ""): boolean {
  const label = answer.questionLabel.replace(/[\s*＊:：]/g, "");
  const value = answer.answer.trim();
  if (!label || !value) return true;
  if (ACCOUNT_PAGE.test(sourceUrl) || NOT_A_LABEL.test(label)) return true;
  // A site's own spelling of the first school / major / degree is learned on purpose.
  if (answer.kind === "field" && ["学校", "专业", "学历"].includes(label)) return false;
  if (BLOCK_PART.test(label)) return true;
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

/** A pending row that is noise by the rules above (rows saved before a rule existed included). */
export function isNoiseChange(row: { kind: string; payload: unknown; sourceUrl: string }): boolean {
  return row.kind === "answer" ? isNoiseAnswer(row.payload as PendingAnswer, row.sourceUrl) : ACCOUNT_PAGE.test(row.sourceUrl);
}

/**
 * What 待核对 shows, after setting aside noise that older captures let in —
 * so the list and its count (the browser's 「待核对 N」) agree.
 */
export async function loadVisiblePending(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.pendingApplicationChange.findMany({ where: visiblePendingWhere(userId), orderBy: { updatedAt: "desc" } });
  const noise = rows.filter(isNoiseChange);
  if (noise.length) await tx.pendingApplicationChange.updateMany({ where: { id: { in: noise.map((row) => row.id) }, status: "pending" }, data: { status: "ignored" } });
  return rows.filter((row) => !noise.includes(row));
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
  const base = parseApplicationProfile(user.applicationProfile);
  const resolved = resolveProfileVariant(base, input.variantId || undefined, input.resumeVersionId || undefined);
  // What fills a blank in 网申资料 is written in now (with 撤销), not reviewed later.
  const learning = ACCOUNT_PAGE.test(input.sourceUrl) ? null : learnFromPage(base, { preferredCities: user.preferredCities }, {
    answers: input.answers, records: input.records, sourceUrl: input.sourceUrl, variantActive: !!resolved.variant, effectiveExtras: resolved.profile.extras,
    memories: memories.map((memory) => ({ category: memory.category, content: (memory.content ?? {}) as MemoryContent })),
  });
  if (learning?.changed) {
    await tx.user.update({ where: { id: userId }, data: { applicationProfile: learning.profile as Prisma.InputJsonValue, ...(learning.preferredCities !== undefined ? { preferredCities: learning.preferredCities } : {}) } });
  }
  const { profile } = learning?.changed ? resolveProfileVariant(learning.profile, input.variantId || undefined, input.resumeVersionId || undefined) : resolved;
  const facts: Record<string, string | null> = { 姓名: user.name, 手机: user.phone, 邮箱: user.contactEmail, 性别: user.gender, 出生日期: user.birthDate, 学校: user.school, 专业: profile.education[0]?.major || null, 学历: profile.education[0]?.degree || null };
  const recordRow = (record: MemoryCapture) => {
    const content = memoryContent(record.category, record.content)!;
    const title = content.name || content.company || content.school || MEMORY_CATEGORIES[record.category];
    return { kind: "record" as const, label: `${MEMORY_CATEGORIES[record.category]} · ${title}`, payload: { ...record, content } };
  };
  const slot = (kind: string, payload: PendingAnswer | MemoryCapture) => kind === "answer"
    ? [(payload as PendingAnswer).kind, (payload as PendingAnswer).fieldKey || normalizeMemoryText((payload as PendingAnswer).questionLabel)]
    : [(payload as MemoryCapture).category, (payload as MemoryCapture).captureKey || memoryIdentity((payload as MemoryCapture).category, (payload as MemoryCapture).content)];
  // An earlier capture of what was just learned no longer needs a review.
  const learnedSlots = [
    ...input.answers.filter((_, i) => learning?.consumedAnswers.has(i)).map((answer) => JSON.stringify(["answer", slot("answer", answer)])),
    ...input.records.filter((_, i) => learning?.consumedRecords.has(i)).map((record) => JSON.stringify(["record", slot("record", recordRow(record).payload)])),
  ];
  for (const item of pending) {
    if (item.status !== "pending" || !learnedSlots.includes(JSON.stringify([item.kind, slot(item.kind, item.payload as PendingAnswer | MemoryCapture)]))) continue;
    pending[pending.indexOf(item)] = await tx.pendingApplicationChange.update({ where: { id: item.id }, data: { status: "accepted", revision: { increment: 1 } } });
  }
  const rows: Array<{ kind: "answer" | "record"; label: string; payload: PendingAnswer | MemoryCapture }> = [
    ...input.answers.filter((answer, i) => !learning?.consumedAnswers.has(i) && !isNoiseAnswer(answer, input.sourceUrl)).map((answer) => ({ kind: "answer" as const, label: answer.questionLabel, payload: answer })),
    ...input.records.filter((_, i) => !learning?.consumedRecords.has(i)).map(recordRow),
  ];
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
      const list = MEMORY_LISTS[record.category].list;
      // The same internship / project / award as one in 网申资料 is already
      // known, even worded a little differently: 网申资料 is where it is kept.
      alreadyKnown = (profile[list] as MemoryContent[]).some((current) => sameMemoryEntity(record.category, current, record.content)) || memories.some((current) => current.category === record.category && [current.content, ...(Array.isArray(current.alternatives) ? current.alternatives.map((item) => (item as { content: MemoryContent }).content) : [])].some((content) => sameMemoryEntity(record.category, content as MemoryContent, record.content) && recordContains(content as MemoryContent, record.content)));
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
  // Noise and learned captures count as handled: the page stops resending them.
  return { staged, processed: input.answers.length + input.records.length, learned: learning?.learned ?? ([] as LearnedNotice[]) };
}

export function evaluatePendingChange(
  view: PendingApplicationChangeView,
  profile: ApplicationProfile,
  profileValues: Record<string, string>
): PendingEvaluation {
  if (view.kind === "record") {
    const capture = view.payload as MemoryCapture;
    const list = MEMORY_LISTS[capture.category].list;
    const existingRows = (profile[list] as MemoryContent[]) || [];
    const matched = existingRows.find((row) => sameMemoryEntity(capture.category, row, capture.content));
    const detailScore = (c: MemoryContent) =>
      Object.values(c).reduce((sum, v) => sum + String(v || "").trim().length, 0);
    const summarize = (c: MemoryContent) =>
      [c.role || c.major || c.level, [c.start || c.date, c.end].filter(Boolean).join("–"), c.description || c.responsibilities || c.text]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 140);
    if (!matched) {
      return {
        verdict: "add_new",
        badge: "建议补充到简历模板",
        reason: `你的网申资料里还没有这段${MEMORY_CATEGORIES[capture.category]}，确认后可一键同步到网申资料与简历底稿`,
        recommendedTarget: "resume_template",
      };
    }
    const incomingLen = detailScore(capture.content);
    const existingLen = detailScore(matched);
    if (incomingLen > existingLen + 12) {
      return {
        verdict: "upgrade_existing",
        badge: "建议升级更新",
        reason: "你手填的内容比现有资料更详细完整，建议同步更新到网申资料与简历底稿",
        currentValue: summarize(matched),
        recommendedTarget: "resume_template",
      };
    }
    return {
      verdict: "conflict_review",
      badge: "与现有资料有差异",
      reason: "与已有经历措辞不同，可按需选择更新简历模板或另存为经历库版本",
      currentValue: summarize(matched),
      recommendedTarget: "profile",
    };
  }

  const answer = view.payload as PendingAnswer;
  if (view.profileField) {
    const current = (profileValues[view.profileField.key] || "").trim();
    if (!current) {
      return {
        verdict: "add_new",
        badge: "建议补充到网申资料",
        reason: `「${view.profileField.label}」在网申资料中为空，保存后后续网申自动填写`,
        recommendedTarget: "profile",
      };
    }
    if (view.profileField.key === "preferredCities" || view.profileField.key === "targetRole") {
      return {
        verdict: "company_specific",
        badge: "按公司/方向核对",
        reason: "该项常随公司与岗位调整，可选择更新为默认资料或仅保留本次",
        currentValue: current,
        recommendedTarget: "memory_local",
      };
    }
    if (answer.answer.trim().length > current.length + 15) {
      return {
        verdict: "upgrade_existing",
        badge: "建议更新为更完整版本",
        reason: `你手填的「${view.profileField.label}」比当前资料更详细，建议更新`,
        currentValue: current,
        recommendedTarget: view.profileField.key === "selfIntro" ? "resume_template" : "profile",
      };
    }
    return {
      verdict: "conflict_review",
      badge: "与现有资料不同",
      reason: `你手填的值与当前「${view.profileField.label}」不同，确认是否替换`,
      currentValue: current,
      recommendedTarget: "profile",
    };
  }

  if (answer.kind === "essay" && companySpecificQuestion(answer.questionLabel)) {
    return {
      verdict: "company_specific",
      badge: "仅建议本岗位保留",
      reason: "该问题与当前公司/岗位强相关，不建议同步到通用简历模板",
      recommendedTarget: "memory_local",
    };
  }

  if (answer.kind === "field" && answer.questionLabel.trim().length <= 24 && answer.answer.trim().length <= 160) {
    const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s：:*＊?？()（）【】[\]_\-]+/g, "");
    const existingCustom = profile.customFields.find((cf) => norm(cf.label) === norm(answer.questionLabel));
    if (existingCustom && existingCustom.value.trim()) {
      return {
        verdict: "conflict_review",
        badge: "与自定义栏位不同",
        reason: `自定义栏位「${existingCustom.label}」已有值，确认是否更新`,
        currentValue: existingCustom.value,
        recommendedTarget: "custom_field",
      };
    }
    return {
      verdict: "add_new",
      badge: "可存为自定义栏位",
      reason: "存为个人自定义空栏后，后续所有网申遇到同类标签都能自动填入",
      recommendedTarget: "custom_field",
    };
  }

  return {
    verdict: "add_new",
    badge: "可沉淀为通用回答",
    reason: "通用开放题回答，确认记住后下次遇到相似问题可直接复用",
    recommendedTarget: "memory_global",
  };
}

export function toPendingApplicationChangeView(row: { id: string; kind: string; label: string; payload: unknown; sourceUrl: string; contextKey: string | null; createdAt: Date; revision: number }): PendingApplicationChangeView {
  const view: PendingApplicationChangeView = { id: row.id, kind: row.kind as "answer" | "record", label: row.label, payload: row.payload as PendingAnswer | MemoryCapture, sourceUrl: row.sourceUrl, contextKey: row.contextKey, createdAt: row.createdAt.toISOString(), revision: row.revision };
  if (view.kind === "answer") {
    const answer = view.payload as PendingAnswer;
    const key = answer.kind !== "essay" || answer.answer.length <= 1000 ? answer.profileKey || profileKeyForLabel(answer.questionLabel) : null;
    if (key && Object.hasOwn(LEARNABLE_FACTS, key)) view.profileField = { key, label: LEARNABLE_FACTS[key] };
  }
  return view;
}
