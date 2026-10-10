// Plain module: finding one company among many 投递记录 — by name, by one of
// its aliases (字节 / ByteDance), by job title, or by pinyin initials typed
// without switching input method (zjtd → 字节跳动). Pure, client and server.

// Pinyin initials without a dictionary: in the zh pinyin collation every
// character sorts after the first character of its initial's block, so the
// last of these boundaries not after a character gives its initial.
const BOUNDARIES = "阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀";
const LETTERS = "abcdefghjklmnopqrstwxyz";
// The collation knows one reading per character; these read differently in
// common names (银行 háng / 自行 xíng, 重庆, 长江, 厦门, 会计), so both count.
const POLYPHONES: Record<string, string> = {
  行: "hx", 重: "cz", 长: "cz", 厦: "xs", 朝: "zc", 曾: "zc", 仇: "qc", 乐: "ly", 单: "dsc", 解: "jx", 藏: "zc", 区: "qo",
  盛: "sc", 调: "dt", 会: "hk", 系: "xj", 省: "sx", 校: "xj", 车: "cj", 石: "sd", 万: "wm", 传: "cz", 查: "cz", 翟: "zd",
  柏: "bp", 尉: "wy", 秘: "mb", 莞: "gw", 广: "g", 期: "q",
};

let collator: Intl.Collator | null | undefined;
const initialCache = new Map<string, string>();

/** The initials a character can stand for: 银 → "y", 行 → "hx", A → "a", "·" → "". */
export function initialsOf(char: string): string {
  if (/^[a-z0-9]$/i.test(char)) return char.toLowerCase();
  if (!/^[\u3400-\u9fff]$/.test(char)) return "";
  if (POLYPHONES[char]) return POLYPHONES[char];
  let initial = initialCache.get(char);
  if (initial === undefined) {
    if (collator === undefined) {
      try { collator = new Intl.Collator("zh-Hans-CN"); } catch { collator = null; }
    }
    initial = "";
    if (collator) for (let i = 0; i < BOUNDARIES.length && collator.compare(BOUNDARIES[i], char) <= 0; i++) initial = LETTERS[i];
    initialCache.set(char, initial);
  }
  return initial;
}

/** A matched stretch of a string, as UTF-16 offsets for highlighting. */
export type Range = { start: number; end: number };

const fold = (value: string) => value.normalize("NFKC").toLowerCase();

/** "数据" in "数据分析师", case- and width-insensitive. */
function textRange(text: string, term: string): Range | null {
  const at = fold(text).indexOf(term);
  // NFKC can change lengths (e.g. "ｱ"); highlight only when it didn't.
  if (at >= 0) return fold(text).length === text.length ? { start: at, end: at + term.length } : { start: 0, end: 0 };
  // "字节 跳动" typed for 字节跳动.
  const bare = fold(text).replace(/\s+/g, "");
  return term.length > 1 && bare.includes(term) ? { start: 0, end: 0 } : null;
}

/** "zjtd" spelling consecutive initials of 字节跳动 (spaces and dots skipped). */
function initialsRange(text: string, term: string): Range | null {
  if (!/^[a-z0-9]+$/.test(term)) return null;
  const chars: { initials: string; start: number; end: number }[] = [];
  let offset = 0;
  for (const char of text) {
    const initials = initialsOf(char);
    if (initials) chars.push({ initials, start: offset, end: offset + char.length });
    offset += char.length;
  }
  // One letter only from the start: "z" alone would otherwise hit every 中国XX.
  const last = term.length === 1 ? 0 : chars.length - term.length;
  for (let start = 0; start <= last; start++) {
    let ok = true;
    for (let j = 0; ok && j < term.length; j++) ok = !!chars[start + j] && chars[start + j].initials.includes(term[j]);
    if (ok) return { start: chars[start].start, end: chars[start + term.length - 1].end };
  }
  return null;
}

function rangeOf(text: string, term: string): Range | null {
  return textRange(text, term) ?? initialsRange(text, term);
}

export type SearchableApplication = { companyName: string; aliases?: string[]; title: string };
/** What matched where; empty ranges mean "matched, but nothing to highlight". */
export type ApplicationHits = { company: Range[]; title: Range[]; alias: string | null };

/**
 * Whether an application matches every space-separated term of `query`
 * ("腾讯 产品" → 腾讯's 产品经理), and where, for highlighting. null if not.
 */
export function matchApplication(app: SearchableApplication, query: string): ApplicationHits | null {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const hits: ApplicationHits = { company: [], title: [], alias: null };
  for (const term of terms) {
    const company = rangeOf(app.companyName, term);
    if (company) { hits.company.push(company); continue; }
    const alias = (app.aliases || []).find((name) => rangeOf(name, term));
    if (alias) { hits.alias = alias; continue; }
    const title = rangeOf(app.title, term);
    if (title) { hits.title.push(title); continue; }
    return null;
  }
  return hits;
}

/** Splits `text` into plain and highlighted parts for rendering. */
export function highlightParts(text: string, ranges: Range[] = []): { text: string; hit: boolean }[] {
  const marks = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const range of marks) {
    if (range.start < at) continue;
    if (range.start > at) parts.push({ text: text.slice(at, range.start), hit: false });
    parts.push({ text: text.slice(range.start, range.end), hit: true });
    at = range.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

let sorter: Intl.Collator | null | undefined;
/** 阿里巴巴, 百度, 字节跳动…: company names in pinyin order. */
export function compareCompanyNames(a: string, b: string): number {
  if (sorter === undefined) {
    try { sorter = new Intl.Collator("zh-Hans-CN", { numeric: true }); } catch { sorter = null; }
  }
  return sorter ? sorter.compare(a, b) : a.localeCompare(b);
}
