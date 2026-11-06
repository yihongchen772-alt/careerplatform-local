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
 * a mail naming another of them (「确认您预约的软件测试工程师初试」, picked 运动控制算法工程师) is about
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
