import { fold, mentions } from "@/lib/mail-application-match";
import { itemDayKey, type ScheduleItem } from "@/lib/interview-schedule";

/**
 * Makes 接下来 read like a person sorted it: a calendar item from an
 * invitation that only says 「比亚迪校园招聘线上测评」 shows as 比亚迪's, with
 * the 投递 it most likely belongs to one click away; and the copy of an
 * interview that is already on its 投递 (the mail's own calendar entry, under
 * the company's full legal name) is not listed twice.
 */

export type RecognizableApplication = { id: string; companyName: string; aliases?: string[]; title: string };

const LEGAL_WORDS = /(?:股份有限公司|有限责任公司|有限公司|集团|股份|公司|科技|技术|控股|中国|china|co\.?,?\s*ltd\.?|inc\.?|group)/gi;

/** 「多场低温科技（北京）有限公司」→「多场低温」, 「多场科技」→「多场」. */
export function companyCore(name: string): string {
  return fold(name).replace(/[（(][^）)]*[）)]/g, "").replace(LEGAL_WORDS, "").replace(/[\s·・\-–—_|｜!！]+/g, "");
}

/** The company a title names, the longest one when several match (华为云 over 华为). */
function namedCompany(text: string, apps: RecognizableApplication[]): { name: string; matched: string; apps: RecognizableApplication[] } | null {
  const haystack = fold(text);
  let best: { name: string; matched: string; length: number } | null = null;
  for (const app of apps) {
    for (const candidate of [app.companyName, ...(app.aliases ?? [])]) {
      if (!candidate || !mentions(haystack, candidate)) continue;
      const length = fold(candidate).length;
      if (!best || length > best.length) best = { name: app.companyName, matched: candidate, length };
    }
  }
  if (!best) return null;
  const name = best.name;
  return { name, matched: best.matched, apps: apps.filter((app) => app.companyName === name) };
}

/** 「比亚迪校园招聘线上测评」 under 比亚迪 reads 「校园招聘线上测评」; too little left keeps it whole. */
export function titleWithoutCompany(title: string, companyName: string): string {
  const trimmed = title.trim();
  const start = fold(trimmed).indexOf(fold(companyName));
  if (start !== 0) return trimmed;
  // NFKC can change length only for full-width letters; find the cut in the original.
  let cut = companyName.length;
  while (cut < trimmed.length && fold(trimmed.slice(0, cut)) !== fold(companyName)) cut += 1;
  const rest = trimmed.slice(cut).replace(/^[\s·・\-–—:：|｜,，]+/, "").replace(/^[（(][^）)]{1,8}[）)]\s*/, "").replace(/^(?:有限公司|股份有限公司|集团|公司)\s*/, "");
  return rest.replace(/[（(]截止[）)]/g, "").trim().length >= 4 ? rest : trimmed;
}

/** Two entries for one sitting: the same start (to the minute, or the same day when neither has a time). */
function sameSlot(left: ScheduleItem, right: ScheduleItem): boolean {
  if (left.hasTime !== right.hasTime) return false;
  if (!left.hasTime) return itemDayKey(left) === itemDayKey(right);
  return Math.abs(new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()) <= 5 * 60_000;
}

function sameCompany(eventText: string, item: ScheduleItem, apps: RecognizableApplication[]): boolean {
  if (!item.companyName) return false;
  const text = fold(eventText);
  const app = apps.find((entry) => entry.id === item.applicationId);
  const names = [item.companyName, ...(app?.aliases ?? [])];
  if (names.some((name) => mentions(text, name))) return true;
  // 「多场科技」's invitation says 「多场低温科技（北京）有限公司」.
  return names.some((name) => {
    const core = companyCore(name);
    return core.length >= 2 && companyCore(eventText).includes(core);
  });
}

export function recognizeSchedule(items: ScheduleItem[], apps: RecognizableApplication[]): ScheduleItem[] {
  const owned = items.filter((item) => item.applicationId);
  const out: ScheduleItem[] = [];
  for (const item of items) {
    if (item.source !== "event" || item.applicationId) {
      out.push(item);
      continue;
    }
    const text = `${item.title}\n${item.meetingInfo ?? ""}`;
    // Already on a 投递 at the same time: the 投递's line says it all.
    if (owned.some((other) => sameSlot(item, other) && (other.kind === item.kind || item.kind === "event") && sameCompany(text, other, apps))) continue;
    const company = namedCompany(item.title, apps) ?? namedCompany(text, apps);
    if (!company) {
      out.push(item);
      continue;
    }
    const titled = company.apps.filter((app) => fold(app.title).length >= 4 && fold(text).includes(fold(app.title)));
    const pick = company.apps.length === 1 ? company.apps[0] : titled.length === 1 ? titled[0] : null;
    out.push({
      ...item,
      companyName: company.name,
      title: titleWithoutCompany(titleWithoutCompany(item.title, company.matched), company.name),
      suggestion: pick ? { applicationId: pick.id, label: `${pick.companyName} · ${pick.title}` } : null,
      companyApplications: company.apps.length,
    });
  }
  return out;
}
