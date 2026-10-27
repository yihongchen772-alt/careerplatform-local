/**
 * Which 投递 a recruiting mail is about, when the AI could not say. Mail names
 * the company in full (「惠州市德赛西威汽车电子股份有限公司笔试邀请」) while the
 * 投递 says 「德赛西威」: a company counts when its name, or one of its aliases,
 * appears in the subject, the company the AI read, or the top of the body.
 */
export type MatchableApplication = { id: string; companyName: string; aliases?: string[]; title: string };

const fold = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/** A name worth matching on: two characters or more, and for Latin names a whole word. */
function mentions(haystack: string, rawName: string): boolean {
  const name = fold(rawName);
  if (name.length < 2) return false;
  if (/^[a-z0-9&.\-]+$/.test(name)) {
    // 「TI」 inside 「entire」 is not Texas Instruments.
    return new RegExp(`(?<![a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(haystack);
  }
  return haystack.includes(name);
}

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
