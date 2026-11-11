/**
 * Which 投递 a recruiting mail is about, when the AI could not say. Mail names
 * the company in full (「惠州市德赛西威汽车电子股份有限公司笔试邀请」) while the
 * 投递 says 「德赛西威」: a company counts when its name, or one of its aliases,
 * appears in the subject, the company the AI read, or the top of the body.
 */
export type MatchableApplication = { id: string; companyName: string; aliases?: string[]; title: string };

export const fold = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/** A name worth matching on: two characters or more, and for Latin names a whole word. */
export function mentions(haystack: string, rawName: string): boolean {
  const name = fold(rawName);
  if (name.length < 2) return false;
  if (/^[a-z0-9&.\-]+$/.test(name)) {
    // 「TI」 inside 「entire」 is not Texas Instruments.
    return new RegExp(`(?<![a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(haystack);
  }
  return haystack.includes(name);
}

const bareJob = (value: string) => fold(value).replace(/[(（【\[][^)）】\]]*[)）】\]]/g, "").replace(/[-_/·,，、|｜:：]/g, "");

/**
 * The AI's pick among several 投递 at one company is checked against the mail:
 * a mail naming another of them (「确认您预约的软件测试工程师初试」, picked 算法工程师) is about
 * that one. A mail naming none keeps the pick; one naming two equally is left unmatched.
 */
export function correctMailApplication(mail: { subject: string; summary?: string; body?: string }, picked: string, apps: MatchableApplication[]): string | null {
  const chosen = apps.find((app) => app.id === picked);
  if (!chosen) return picked;
  const siblings = apps.filter((app) => app.companyName === chosen.companyName);
  if (siblings.length < 2) return picked;
  const text = bareJob(`${mail.subject} ${mail.summary ?? ""} ${mail.body ?? ""}`);
  const named = siblings.map((app) => ({ app, key: bareJob(app.title) })).filter((entry) => entry.key.length >= 4 && text.includes(entry.key)).sort((a, b) => b.key.length - a.key.length);
  if (!named.length || named[0].app.id === picked) return picked;
  const pickedEntry = named.find((entry) => entry.app.id === picked);
  // As closely named as the best (the same title applied to twice): keep the pick.
  if (pickedEntry && pickedEntry.key.length === named[0].key.length) return picked;
  // Named too, and not just as a part of the longer title: the mail may be about both.
  if (pickedEntry && !named[0].key.includes(pickedEntry.key)) return picked;
  if (named[1] && named[1].key.length === named[0].key.length && named[1].key !== named[0].key) return null;
  return named[0].app.id;
}

const GENERIC_ENDING = /^(?:\(.*|[!。.·]+|股份.*|集团.*|有限.*|公司|科技.*|技术.*|中国|电子.*|微电子.*|控股.*|[a-z][a-z&.\-]*)$/;

export function matchMailApplication(
  mail: { subject: string; company?: string | null; body?: string },
  apps: MatchableApplication[]
): string | null {
  const haystack = fold(`${mail.subject} ${mail.company ?? ""} ${(mail.body ?? "").slice(0, 400)}`);
  const hits: { app: MatchableApplication; length: number }[] = [];
  for (const app of apps) {
    let length = 0;
    for (const name of [app.companyName, ...(app.aliases ?? [])]) if (mentions(haystack, name)) length = Math.max(length, fold(name).length);
    if (length) hits.push({ app, length });
  }
  // The mail signs with less than the record says: 「星海」 for 星海股份, 「天工」 for 天工！. Only when
  // what's left is a generic ending: 「京北」 is not 京北方.
  const signed = fold(mail.company ?? "").replace(/\([^)]*\)/g, "");
  if (!hits.length && signed.length >= 2) {
    for (const app of apps) {
      const name = fold(app.companyName);
      if (name.startsWith(signed) && GENERIC_ENDING.test(name.slice(signed.length))) hits.push({ app, length: signed.length });
    }
  }
  if (!hits.length) return null;
  // 「华为云」 beats 「华为」 when both are named: the more specific company.
  const longest = Math.max(...hits.map((hit) => hit.length));
  const best = hits.filter((hit) => hit.length === longest).map((hit) => hit.app);
  if (new Set(best.map((app) => app.companyName)).size > 1) return null;
  if (best.length === 1) return best[0].id;
  // Several 岗位 at one company: the one whose title the mail repeats.
  const full = fold(`${mail.subject} ${mail.body ?? ""}`);
  const named = best.filter((app) => fold(app.title).length >= 4 && full.includes(fold(app.title)));
  return named.length === 1 ? named[0].id : null;
}

/** Words that say what kind of job it is. Two titles sharing none are different jobs. */
const ROLE_WORDS = ["测试", "算法", "软件", "硬件", "电气", "机械", "结构", "嵌入式", "前端", "后端", "产品", "运营", "销售", "市场", "数据", "质量", "工艺", "供应链", "采购", "财务", "人力", "客户", "项目", "仿真", "电机", "芯片", "射频", "运维", "plc", "自动化", "机器人", "视觉", "控制", "通信", "网络", "安全", "需求", "规划", "电子", "化工", "材料"];

function roleWords(title: string): Set<string> {
  const text = bareJob(title);
  return new Set(ROLE_WORDS.filter((word) => text.includes(word)));
}

/**
 * The mail names one job and the record is another kind of job at that
 * company (「软件测试工程师」 vs 「运动控制算法工程师」). A category record
 * (「上海校招 - 测试类」) still fits a 测试 mail; a title with no role word fits anything.
 */
export function jobConflicts(mailJob: string | null | undefined, recordTitle: string): boolean {
  const said = bareJob(mailJob ?? "");
  const record = bareJob(recordTitle);
  if (said.length < 2 || !record || said.includes(record) || record.includes(said)) return false;
  const a = roleWords(said);
  const b = roleWords(record);
  if (!a.size || !b.size) return false;
  for (const word of a) if (b.has(word)) return false;
  return true;
}

function companyNamed(haystack: string, app: MatchableApplication) {
  return [app.companyName, ...(app.aliases ?? [])].some((name) => mentions(haystack, name));
}

/**
 * Which 投递 a mail is about, from the AI's pick (if any) checked against the mail:
 * - a pick at a company the mail never names, while it names another one you
 *   applied to, is a slip (a 博凯 reminder linked to a 中国移动 record): the
 *   company the mail names wins;
 * - among one company's records the job the mail spells out wins, closed ones
 *   included (`all`): an invitation for a job marked 已拒 still belongs to it;
 * - a record of another kind of job than the one the mail names is not it.
 */
export function resolveMailApplication(
  mail: { subject: string; company?: string | null; summary?: string; body?: string; jobTitle?: string | null },
  picked: string | null,
  active: MatchableApplication[],
  all: MatchableApplication[] = active
): string | null {
  const text = { subject: mail.subject, company: mail.company, body: `${mail.summary ?? ""} ${mail.body ?? ""}` };
  const haystack = fold(`${mail.subject} ${mail.company ?? ""} ${mail.summary ?? ""} ${(mail.body ?? "").slice(0, 400)}`);
  let chosen = picked && active.some((app) => app.id === picked) ? picked : null;
  if (chosen) {
    const app = active.find((entry) => entry.id === chosen)!;
    if (!companyNamed(haystack, app) && all.some((other) => other.companyName !== app.companyName && companyNamed(haystack, other))) {
      chosen = matchMailApplication(text, active);
    }
  } else {
    chosen = matchMailApplication(text, active);
  }
  const pool = [...active, ...all.filter((app) => !active.some((entry) => entry.id === app.id))];
  if (chosen) chosen = correctMailApplication({ subject: mail.subject, summary: [mail.summary, mail.jobTitle].filter(Boolean).join(" "), body: mail.body }, chosen, pool);
  const app = chosen ? pool.find((entry) => entry.id === chosen) : null;
  if (app && jobConflicts(mail.jobTitle, app.title)) return null;
  return chosen;
}
