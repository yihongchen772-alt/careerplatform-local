import { z } from "zod";

/*
 * 简历底稿: a resume as structured, editable data, laid out the way Chinese
 * campus resumes are — a header (name, 求职意向 line, contact lines, photo)
 * and sections that are either 条目 (school / company / project: a title row
 * with the date on the right, an optional tech-stack line, detail lines and
 * bullets), a bulleted list, or plain lines. The only inline markup is
 * **bold**.
 *
 * Every piece of text has an address (see textAt), so the AI's edits, the
 * review list's 改回/用这条 and typing in the preview all touch the same
 * thing, and one renderer makes the preview, the PDF and the Word file.
 * Plain module: used by the server actions and the editor alike.
 */

export const DEFAULT_ACCENT = "#1f4e99";
const ID = /^[a-z][a-z0-9]{0,15}$/;

function cleanText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text
    .replace(/ /g, " ")
    .replace(/[\r\n\t\f\v]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max);
}

const str = (max: number) => z.unknown().optional().transform((value) => cleanText(value, max));
const idSchema = z.string().regex(ID);
const paraSchema = z.object({ id: idSchema, text: str(1200) });

const entrySchema = z.object({
  id: idSchema,
  title: str(160),
  subtitle: str(240),
  date: str(60),
  tags: str(400),
  lines: z.array(paraSchema).max(12).catch([]),
  bullets: z.array(paraSchema).max(20).catch([]),
  hidden: z.boolean().optional().catch(undefined),
});

const sectionSchema = z.object({
  id: idSchema,
  heading: str(40),
  layout: z.enum(["entries", "list", "lines"]).catch("lines"),
  columns: z.union([z.literal(1), z.literal(2)]).catch(1),
  entries: z.array(entrySchema).max(24).catch([]),
  items: z.array(paraSchema).max(48).catch([]),
  hidden: z.boolean().optional().catch(undefined),
});

/** Only an embedded raster image: the photo is printed into the PDF as-is. */
const PHOTO = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export const resumeDocSchema = z.object({
  name: str(40),
  headline: str(160),
  contacts: z.array(paraSchema).max(6).catch([]),
  photo: z.string().max(4_000_000).regex(PHOTO).nullable().catch(null),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).catch(DEFAULT_ACCENT),
  /** Shrinks every font size together so a long version still fits one page. */
  fontScale: z.number().min(0.8).max(1.1).catch(1),
  /** Set on a freshly generated version: the editor shrinks it to one page once if it runs a little over. */
  autoFit: z.boolean().optional().catch(undefined),
  sections: z.array(sectionSchema).max(16).catch([]),
});

export type ResumePara = z.infer<typeof paraSchema>;
export type ResumeEntry = z.infer<typeof entrySchema>;
export type ResumeSection = z.infer<typeof sectionSchema>;
export type ResumeDoc = z.infer<typeof resumeDocSchema>;

/** What the reading AI returns: the same shape without ids. */
export type ParsedResume = {
  name?: unknown;
  headline?: unknown;
  contacts?: unknown;
  hasPhoto?: unknown;
  sections?: {
    heading?: unknown;
    layout?: unknown;
    columns?: unknown;
    entries?: { title?: unknown; subtitle?: unknown; date?: unknown; tags?: unknown; lines?: unknown; bullets?: unknown }[];
    items?: unknown;
  }[];
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => cleanText(item, 1200)).filter(Boolean) : [];
}

/** Gives the parsed resume its ids: sections s1…, entries e1…, text p1…, contact lines c1…. */
export function docFromParsed(parsed: ParsedResume, photo: string | null = null): ResumeDoc {
  let s = 0;
  let e = 0;
  let p = 0;
  const para = (text: string) => ({ id: `p${++p}`, text });
  const sections = (Array.isArray(parsed.sections) ? parsed.sections : []).map((section) => {
    const layout = section.layout === "entries" || section.layout === "list" ? section.layout : "lines";
    const entries = layout === "entries" && Array.isArray(section.entries)
      ? section.entries.map((entry) => ({
          id: `e${++e}`,
          title: cleanText(entry.title, 160),
          subtitle: cleanText(entry.subtitle, 240),
          date: cleanText(entry.date, 60),
          tags: cleanText(entry.tags, 400),
          lines: strings(entry.lines).map(para),
          bullets: strings(entry.bullets).map(para),
        })).filter((entry) => entry.title || entry.subtitle || entry.bullets.length || entry.lines.length)
      : [];
    return {
      id: `s${++s}`,
      heading: cleanText(section.heading, 40),
      layout: layout as ResumeSection["layout"],
      columns: (Number(section.columns) === 2 ? 2 : 1) as 1 | 2,
      entries,
      items: layout === "entries" ? [] : strings(section.items).map(para),
    };
  }).filter((section) => section.heading && (section.entries.length || section.items.length));
  return resumeDocSchema.parse({
    name: parsed.name,
    headline: parsed.headline,
    contacts: strings(parsed.contacts).map((text, index) => ({ id: `c${index + 1}`, text })),
    photo,
    accent: DEFAULT_ACCENT,
    fontScale: 1,
    sections,
  });
}

// ── addresses ────────────────────────────────────────────────────────────
// "name", "headline", "s3.heading", "e2.title" / ".subtitle" / ".date" /
// ".tags", or the id of one contact line / detail line / bullet / item.

const ENTRY_FIELDS = ["title", "subtitle", "date", "tags"] as const;
type EntryField = (typeof ENTRY_FIELDS)[number];

function splitAddress(address: string): [string, string | null] {
  const dot = address.indexOf(".");
  return dot < 0 ? [address, null] : [address.slice(0, dot), address.slice(dot + 1)];
}

function paraLists(doc: ResumeDoc): ResumePara[][] {
  const lists: ResumePara[][] = [doc.contacts];
  for (const section of doc.sections) {
    lists.push(section.items);
    for (const entry of section.entries) lists.push(entry.lines, entry.bullets);
  }
  return lists;
}

export function textAt(doc: ResumeDoc, address: string): string | null {
  if (address === "name") return doc.name;
  if (address === "headline") return doc.headline;
  const [id, field] = splitAddress(address);
  if (field === "heading") return doc.sections.find((section) => section.id === id)?.heading ?? null;
  if (field) {
    if (!ENTRY_FIELDS.includes(field as EntryField)) return null;
    for (const section of doc.sections) {
      const entry = section.entries.find((item) => item.id === id);
      if (entry) return entry[field as EntryField];
    }
    return null;
  }
  for (const list of paraLists(doc)) {
    const found = list.find((item) => item.id === id);
    if (found) return found.text;
  }
  return null;
}

function mapParas(list: ResumePara[], id: string, fn: (para: ResumePara) => ResumePara): ResumePara[] {
  return list.some((item) => item.id === id) ? list.map((item) => (item.id === id ? fn(item) : item)) : list;
}

/** A copy with the text at `address` replaced (unchanged when the address is unknown). */
export function withText(doc: ResumeDoc, address: string, value: string): ResumeDoc {
  const text = cleanText(value, 1200);
  if (address === "name") return { ...doc, name: text.slice(0, 40) };
  if (address === "headline") return { ...doc, headline: text.slice(0, 160) };
  const [id, field] = splitAddress(address);
  if (field === "heading") {
    return { ...doc, sections: doc.sections.map((section) => (section.id === id ? { ...section, heading: text.slice(0, 40) } : section)) };
  }
  if (field) {
    if (!ENTRY_FIELDS.includes(field as EntryField)) return doc;
    return {
      ...doc,
      sections: doc.sections.map((section) => ({
        ...section,
        entries: section.entries.map((entry) => (entry.id === id ? { ...entry, [field]: text } : entry)),
      })),
    };
  }
  const set = (para: ResumePara) => ({ ...para, text });
  return {
    ...doc,
    contacts: mapParas(doc.contacts, id, set),
    sections: doc.sections.map((section) => ({
      ...section,
      items: mapParas(section.items, id, set),
      entries: section.entries.map((entry) => ({ ...entry, lines: mapParas(entry.lines, id, set), bullets: mapParas(entry.bullets, id, set) })),
    })),
  };
}

/** The ids a section (its entries, or its items) or an entry (its bullets) holds, in order. */
export function childrenOf(doc: ResumeDoc, parent: string): string[] | null {
  for (const section of doc.sections) {
    if (section.id === parent) return (section.layout === "entries" ? section.entries : section.items).map((item) => item.id);
    const entry = section.entries.find((item) => item.id === parent);
    if (entry) return entry.bullets.map((item) => item.id);
  }
  return null;
}

function reorder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.length === items.length && ids.every((id) => byId.has(id)) && new Set(ids).size === ids.length ? ids.map((id) => byId.get(id)!) : items;
}

/** A copy with `parent`'s children in the given order — only a true rearrangement is applied. */
export function withOrder(doc: ResumeDoc, parent: string, ids: string[]): ResumeDoc {
  return {
    ...doc,
    sections: doc.sections.map((section) => {
      if (section.id === parent) {
        return section.layout === "entries" ? { ...section, entries: reorder(section.entries, ids) } : { ...section, items: reorder(section.items, ids) };
      }
      return { ...section, entries: section.entries.map((entry) => (entry.id === parent ? { ...entry, bullets: reorder(entry.bullets, ids) } : entry)) };
    }),
  };
}

/** Hides (or shows again) a whole section or entry — hidden ones are left out of the PDF. */
export function withHidden(doc: ResumeDoc, id: string, hidden: boolean): ResumeDoc {
  return {
    ...doc,
    sections: doc.sections.map((section) =>
      section.id === id
        ? { ...section, hidden: hidden || undefined }
        : { ...section, entries: section.entries.map((entry) => (entry.id === id ? { ...entry, hidden: hidden || undefined } : entry)) }
    ),
  };
}

function nextParaId(doc: ResumeDoc): string {
  let max = 0;
  for (const list of paraLists(doc)) for (const item of list) {
    const n = /^p(\d+)$/.exec(item.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `p${max + 1}`;
}

/** Enter at the end of a bullet: a new bullet right after it (same list). */
export function withParaAfter(doc: ResumeDoc, afterId: string, text = ""): { doc: ResumeDoc; id: string } {
  const id = nextParaId(doc);
  const insert = (list: ResumePara[]) => {
    const index = list.findIndex((item) => item.id === afterId);
    return index < 0 ? list : [...list.slice(0, index + 1), { id, text: cleanText(text, 1200) }, ...list.slice(index + 1)];
  };
  return {
    id,
    doc: {
      ...doc,
      sections: doc.sections.map((section) => ({
        ...section,
        items: insert(section.items),
        entries: section.entries.map((entry) => ({ ...entry, lines: insert(entry.lines), bullets: insert(entry.bullets) })),
      })),
    },
  };
}

/** Removes one bullet / line / item (a contact line can only be emptied). */
export function withoutPara(doc: ResumeDoc, id: string): ResumeDoc {
  const drop = (list: ResumePara[]) => list.filter((item) => item.id !== id);
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      items: drop(section.items),
      entries: section.entries.map((entry) => ({ ...entry, lines: drop(entry.lines), bullets: drop(entry.bullets) })),
    })),
  };
}

// ── text views ───────────────────────────────────────────────────────────

export function stripBold(text: string): string {
  return text.replace(/\*\*/g, "");
}

function short(text: string, max = 14): string {
  const plain = stripBold(text);
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

/** The resume as readable plain text — 网申 answers and the checks below read this. */
export function docPlainText(doc: ResumeDoc): string {
  const out = [doc.name, doc.headline, ...doc.contacts.map((c) => c.text)];
  for (const section of doc.sections) {
    if (section.hidden) continue;
    out.push("", section.heading);
    for (const entry of section.entries) {
      if (entry.hidden) continue;
      out.push([entry.title, entry.subtitle, entry.date].filter(Boolean).join("  "));
      if (entry.tags) out.push(entry.tags);
      for (const line of entry.lines) out.push(line.text);
      for (const bullet of entry.bullets) out.push(`• ${bullet.text}`);
    }
    for (const item of section.items) out.push(section.layout === "list" ? `• ${item.text}` : item.text);
  }
  return stripBold(out.filter((line, index) => line || out[index - 1]).join("\n")).trim();
}

/**
 * What the tailoring AI reads: every line it may change starts with its
 * address in [brackets]; <s1>/<e2> mark the sections and entries it may
 * reorder; everything else is context only.
 */
export function docOutline(doc: ResumeDoc): string {
  const out = [`姓名：${doc.name}`];
  if (doc.headline) out.push(`[headline] ${doc.headline}`);
  for (const contact of doc.contacts) out.push(`联系方式：${contact.text}`);
  for (const section of doc.sections) {
    if (section.hidden) continue;
    out.push(`== <${section.id}> ${section.heading}`);
    for (const entry of section.entries) {
      if (entry.hidden) continue;
      out.push(`  <${entry.id}> ${[entry.title, entry.subtitle].filter(Boolean).join(" ")}${entry.date ? ` ｜ ${entry.date}` : ""}`);
      if (entry.tags) out.push(`    [${entry.id}.tags] ${entry.tags}`);
      for (const line of entry.lines) out.push(`    [${line.id}] ${line.text}`);
      for (const bullet of entry.bullets) out.push(`    [${bullet.id}] • ${bullet.text}`);
    }
    for (const item of section.items) out.push(`  [${item.id}] ${section.layout === "list" ? "• " : ""}${item.text}`);
  }
  return out.join("\n");
}

/** Where an address is, in words: 「项目经历 · 基于深度强化… · 第 2 条」. */
export function labelFor(doc: ResumeDoc, address: string): string {
  if (address === "headline") return "求职意向";
  if (address === "name") return "姓名";
  const [id, field] = splitAddress(address);
  if (doc.contacts.some((c) => c.id === id)) return "联系方式";
  for (const section of doc.sections) {
    if (section.id === id) return section.heading;
    const itemIndex = section.items.findIndex((item) => item.id === id);
    if (itemIndex >= 0) return `${section.heading} · 第 ${itemIndex + 1} 行`;
    for (const entry of section.entries) {
      const name = short(entry.title || entry.subtitle);
      if (entry.id === id) {
        const what = field === "tags" ? "技术栈" : field === "date" ? "时间" : field === "subtitle" ? "副标题" : field === "title" ? "标题" : "";
        return [section.heading, name, what].filter(Boolean).join(" · ");
      }
      const line = entry.lines.findIndex((item) => item.id === id);
      if (line >= 0) return `${section.heading} · ${name} · ${short(entry.lines[line].text, 6)}`;
      const bullet = entry.bullets.findIndex((item) => item.id === id);
      if (bullet >= 0) return `${section.heading} · ${name} · 第 ${bullet + 1} 条`;
    }
  }
  return address;
}

// ── checks against invented facts ────────────────────────────────────────

const NUMBER = /\d+(?:\.\d+)?/g;
const TERM = /[A-Za-z][A-Za-z0-9+#]*(?:[./-][A-Za-z0-9+#]+)*/g;

/** Numbers in `after` that appear nowhere in the original resume. */
export function introducedNumbers(after: string, corpus: string): string[] {
  const known = new Set(corpus.match(NUMBER) ?? []);
  return [...new Set((stripBold(after).match(NUMBER) ?? []).filter((n) => !known.has(n)))];
}

/** Latin-script terms (tools, skills, acronyms) in `after` that the original resume never mentions. */
export function introducedTerms(after: string, corpus: string): string[] {
  const known = corpus.toLowerCase();
  return [...new Set((stripBold(after).match(TERM) ?? []).filter((term) => term.length >= 2 && !known.includes(term.toLowerCase())))];
}

// ── word-level diff for the review list ──────────────────────────────────

export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

function tokens(text: string): string[] {
  return text.match(/[A-Za-z0-9+#.%]+|\s+|[\s\S]/gu) ?? [];
}

/** Shortest edit between two short texts, as kept / removed / added runs. */
export function diffText(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > 250_000) return [{ kind: "del", text: before }, { kind: "ins", text: after }];
  const dp: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", a[i++]);
    else push("ins", b[j++]);
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("ins", b[j++]);
  return parts;
}

// ── rendering ────────────────────────────────────────────────────────────

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escaped HTML with **bold** spans as <b>. */
export function richToHtml(text: string): string {
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
}

type NodeLike = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
};

/** Reads an edited element back into **bold** text (bold from ⌘B, <strong> or font-weight). */
export function richFromNode(node: NodeLike, inBold = false): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out += child.textContent ?? "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.nodeName.toLowerCase();
    if (tag === "br") {
      out += " ";
      continue;
    }
    if (tag === "script" || tag === "style") continue;
    const style = child.getAttribute?.("style") ?? "";
    const bold = !inBold && (tag === "b" || tag === "strong" || /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style));
    const inner = richFromNode(child, inBold || bold);
    out += bold && inner.trim() ? `**${inner}**` : inner;
  }
  return inBold ? out : cleanText(out.replace(/\*\*\*\*/g, ""), 1200);
}

const BASE_CSS = `
@page { size: A4; margin: 10mm 12.5mm 9.5mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
.page { color: #222; font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif; font-size: calc(9.5pt * var(--s)); line-height: 1.36; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; }
.who { min-width: 0; flex: 1; }
.name { margin: 0; font-size: calc(21pt * var(--s)); font-weight: 700; line-height: 1.25; letter-spacing: 0.02em; }
.headline { margin-top: calc(1pt * var(--s)); color: var(--accent); font-weight: 700; font-size: calc(11.5pt * var(--s)); }
.contact { color: #444; font-size: calc(9.2pt * var(--s)); line-height: 1.34; }
.photo { flex: none; width: 20mm; height: 25.5mm; object-fit: cover; object-position: center top; }
h2 { margin: calc(5pt * var(--s)) 0 calc(2.5pt * var(--s)); padding-bottom: calc(1pt * var(--s)); border-bottom: 1pt solid var(--accent); color: var(--accent); font-size: calc(12pt * var(--s)); line-height: 1.3; break-after: avoid; }
.entry { position: relative; margin-top: calc(2.5pt * var(--s)); }
.entry:first-of-type { margin-top: 0; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 8pt; }
.what { min-width: 0; }
.when { flex: none; white-space: nowrap; color: #333; }
.tags { color: var(--accent); font-size: calc(9pt * var(--s)); }
ul { margin: 0; padding: 0; list-style: none; }
li { padding-left: 0.95em; }
/* In the flow (not absolutely placed), so a PDF's text reads "• 要点" in order. */
li::before { content: "•"; display: inline-block; width: 0.95em; margin-left: -0.95em; padding-left: 0.12em; }
/* Two columns read left to right, row by row, like resume templates lay them out. */
.cols2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; }
b { font-weight: 700; }
@media screen { .page { width: 210mm; min-height: 297mm; padding: 10mm 12.5mm 9.5mm; } }
`;

/** Preview-only: hover outlines, highlighted AI changes, hide buttons and the page-end line. */
export const RESUME_EDIT_CSS = `
body { background: #fff; }
.page { position: relative; }
[contenteditable="true"] { outline: none; border-radius: 2px; }
[contenteditable="true"]:hover { box-shadow: 0 0 0 1px rgba(59,130,246,.35); }
[contenteditable="true"]:focus { box-shadow: 0 0 0 1.5px rgba(59,130,246,.85); }
.cp-changed { background: rgba(250, 204, 21, .3); }
.cp-off .cp-changed { background: none; }
.cp-hidden { opacity: .35; }
.cp-hidden .cp-ctl { opacity: 1; }
.cp-ctl { position: absolute; top: 0; right: -11mm; display: none; width: 10mm; padding: 1px 0; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #334155; font: 11px/1.4 system-ui, sans-serif; text-align: center; cursor: pointer; }
.cp-ctl:hover { background: #f1f5f9; }
.entry:hover > .cp-ctl, section:hover > .cp-ctl, .cp-hidden > .cp-ctl { display: block; }
section { position: relative; }
.cp-flash { animation: cp-flash 1.4s ease-out; }
@keyframes cp-flash { from { background: rgba(59,130,246,.35); } to { background: transparent; } }
.cp-pageend { position: absolute; left: 0; right: 0; top: 287.5mm; border-top: 1.5px dashed #ef4444; pointer-events: none; }
.cp-pageend span { position: absolute; right: 3mm; top: 2px; padding: 0 4px; background: #fff; color: #ef4444; font: 11px/1.4 system-ui, sans-serif; }
`;

export type RenderOptions = {
  /** Preview: data-id on every text, hidden parts shown faded with 恢复 buttons, the page-end line. */
  editable?: boolean;
  /** Addresses to highlight as AI changes. */
  changed?: ReadonlySet<string>;
  /** Word flavour: title rows and the header as tables, which Word lays out reliably. */
  word?: boolean;
};

/** The page itself (what goes inside <body>). */
export function renderResumeBody(doc: ResumeDoc, options: RenderOptions = {}): string {
  const { editable = false, changed, word = false } = options;
  const tag = (name: string, address: string, text: string, cls = "") => {
    const classes = editable && changed?.has(address) ? `${cls} cp-changed`.trim() : cls;
    return `<${name}${editable ? ` data-id="${esc(address)}"` : ""}${classes ? ` class="${classes}"` : ""}>${richToHtml(text)}</${name}>`;
  };
  const ctl = (id: string, hidden: boolean | undefined, what: string) =>
    editable
      ? `<button type="button" class="cp-ctl" data-act="${hidden ? "show" : "hide"}" data-target="${esc(id)}" title="${hidden ? `恢复这${what}` : `隐藏这${what}（不出现在 PDF 里）`}">${hidden ? "恢复" : "隐藏"}</button>`
      : "";
  const row = (what: string, when: string) =>
    word
      ? `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td>${what}</td><td align="right" valign="top" style="white-space:nowrap">${when}</td></tr></table>`
      : `<div class="row"><div class="what">${what}</div>${when}</div>`;

  const who = [
    tag("h1", "name", doc.name || "姓名", "name"),
    doc.headline ? tag("div", "headline", doc.headline, "headline") : "",
    ...doc.contacts.filter((c) => c.text || editable).map((c) => tag("div", c.id, c.text, "contact")),
  ].join("");
  const head = word
    ? `<table width="100%" cellspacing="0" cellpadding="0"><tr><td valign="top">${who}</td>${doc.photo ? `<td width="86" align="right" valign="top"><img src="${doc.photo}" width="80" height="103" alt=""></td>` : ""}</tr></table>`
    : `<div class="head"><div class="who">${who}</div>${doc.photo ? `<img class="photo" src="${doc.photo}" alt="">` : ""}</div>`;

  const sections = doc.sections
    .filter((section) => editable || !section.hidden)
    .map((section) => {
      const body =
        section.layout === "entries"
          ? section.entries
              .filter((entry) => editable || !entry.hidden)
              .map((entry) => {
                const what = `${entry.title ? tag("b", `${entry.id}.title`, entry.title) : ""}${entry.subtitle ? ` ${tag("span", `${entry.id}.subtitle`, entry.subtitle)}` : ""}`;
                const when = entry.date ? tag(word ? "span" : "div", `${entry.id}.date`, entry.date, "when") : "";
                const tags = entry.tags ? tag("div", `${entry.id}.tags`, entry.tags, "tags") : "";
                const lines = entry.lines.map((line) => tag("div", line.id, line.text, "line")).join("");
                const bullets = entry.bullets.length ? `<ul>${entry.bullets.map((b) => tag("li", b.id, b.text)).join("")}</ul>` : "";
                return `<div class="entry${editable && entry.hidden ? " cp-hidden" : ""}">${ctl(entry.id, entry.hidden, "段")}${row(what, when)}${tags}${lines}${bullets}</div>`;
              })
              .join("")
          : section.layout === "list"
            ? `<ul${section.columns === 2 ? ' class="cols2"' : ""}>${section.items.map((item) => tag("li", item.id, item.text)).join("")}</ul>`
            : `<div${section.columns === 2 ? ' class="cols2"' : ""}>${section.items.map((item) => tag("div", item.id, item.text, "line")).join("")}</div>`;
      return `<section${editable && section.hidden ? ' class="cp-hidden"' : ""}>${ctl(section.id, section.hidden, "个板块")}${tag("h2", `${section.id}.heading`, section.heading)}${body}</section>`;
    })
    .join("");

  const accent = /^#[0-9a-f]{6}$/i.test(doc.accent) ? doc.accent : DEFAULT_ACCENT;
  return `<div class="page" style="--s:${doc.fontScale};--accent:${accent}">${head}${sections}${editable ? '<div class="cp-pageend"><span>第 1 页到这里</span></div>' : ""}</div>`;
}

/** A complete standalone page — the PDF is printed from exactly this. */
export function renderResumeHtml(doc: ResumeDoc, title: string, options: RenderOptions = {}): string {
  const css = options.editable ? `${BASE_CSS}${RESUME_EDIT_CSS}` : BASE_CSS;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${renderResumeBody(doc, options)}</body></html>`;
}

/** The same resume as a Word-openable .doc (Word and WPS both read this HTML flavour), for editing outside. */
export function renderResumeWord(doc: ResumeDoc, title: string): string {
  const accent = /^#[0-9a-f]{6}$/i.test(doc.accent) ? doc.accent : DEFAULT_ACCENT;
  const css = BASE_CSS
    .replace(/calc\(([\d.]+)pt \* var\(--s\)\)/g, (_m, n: string) => `${(Number(n) * doc.fontScale).toFixed(2)}pt`)
    .replace(/var\(--accent\)/g, accent)
    .replace(/li::before[^}]*}/, "")
    .replace("ul { margin: 0; padding: 0; list-style: none; }", "ul { margin: 0 0 0 14pt; padding: 0; }")
    .replace("li { padding-left: 0.95em; }", "");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>${css}</style></head><body>${renderResumeBody(doc, { word: true })}</body></html>`;
}

// ── the 定制 draft stored on ResumeTailoring.draft ───────────────────────

const textChangeSchema = z.object({
  kind: z.literal("text"),
  address: z.string().max(40),
  label: z.string().max(120).catch(""),
  before: z.string().max(1500),
  after: z.string().max(1500),
  reason: z.string().max(200).catch(""),
  /** Why it is not applied by default: a number or term the original never had. */
  flag: z.string().max(200).optional().catch(undefined),
});

const orderChangeSchema = z.object({
  kind: z.literal("order"),
  parent: z.string().max(20),
  label: z.string().max(120).catch(""),
  before: z.array(z.string().max(20)).max(48),
  after: z.array(z.string().max(20)).max(48),
  reason: z.string().max(200).catch(""),
});

export const tailorChangeSchema = z.discriminatedUnion("kind", [textChangeSchema, orderChangeSchema]);
export type TailorChange = z.infer<typeof tailorChangeSchema>;

export const tailorTargetSchema = z.object({
  company: str(80),
  title: str(120),
  jdText: z.unknown().optional().transform((value) => (typeof value === "string" ? value.trim().slice(0, 20000) : "")),
  url: z.unknown().optional().transform((value) => (typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim().slice(0, 2000) : "")),
});
export type TailorTarget = z.infer<typeof tailorTargetSchema>;

export const tailorDraftSchema = z.object({
  v: z.literal(2).catch(2),
  target: tailorTargetSchema,
  /** "text": wording only; "order": may also reorder entries and bullets. */
  mode: z.enum(["text", "order"]).catch("text"),
  /** The 底稿 as it was when the changes were made (without the photo). */
  base: resumeDocSchema.nullable().catch(null),
  doc: resumeDocSchema.nullable().catch(null),
  changes: z.array(tailorChangeSchema).max(60).catch([]),
  summary: z.string().max(400).catch(""),
  keywords: z.array(z.object({ word: z.string().max(40), covered: z.boolean() })).max(20).catch([]),
  generatedAt: z.string().nullable().catch(null),
});
export type TailorDraft = z.infer<typeof tailorDraftSchema>;

export function parseDraft(value: unknown): TailorDraft | null {
  if (!value || typeof value !== "object") return null;
  const parsed = tailorDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ChangeState = "applied" | "reverted" | "edited";

/** Whether a change is in the document now, was undone, or has since been typed over. */
export function changeState(doc: ResumeDoc, change: TailorChange): ChangeState {
  if (change.kind === "text") {
    const now = textAt(doc, change.address);
    return now === change.after ? "applied" : now === change.before ? "reverted" : "edited";
  }
  const now = childrenOf(doc, change.parent)?.join(",");
  return now === change.after.join(",") ? "applied" : now === change.before.join(",") ? "reverted" : "edited";
}

/** Puts one change in (`on`) or takes it back out. */
export function withChange(doc: ResumeDoc, change: TailorChange, on: boolean): ResumeDoc {
  if (change.kind === "text") return withText(doc, change.address, on ? change.after : change.before);
  return withOrder(doc, change.parent, on ? change.after : change.before);
}

/** Addresses whose text an applied AI change wrote — highlighted in the preview. */
export function changedAddresses(doc: ResumeDoc, changes: TailorChange[]): Set<string> {
  return new Set(changes.filter((change) => change.kind === "text" && changeState(doc, change) === "applied").map((change) => (change as { address: string }).address));
}

// ── turning the AI's answer into checked changes ─────────────────────────

/** What the tailoring AI answers (see actions/resume-tailor.ts). */
export type TailorAnswer = {
  company?: unknown;
  title?: unknown;
  summary?: unknown;
  keywords?: { word?: unknown; covered?: unknown }[];
  edits?: { id?: unknown; text?: unknown; reason?: unknown }[];
  order?: { parent?: unknown; children?: unknown; reason?: unknown }[];
};

const EDITABLE_FIELD = /^e\d+\.tags$/;

/** Turns the AI's answer into checked changes; ones that bring in a new number or term stay unapplied. */
export function buildTailorChanges(base: ResumeDoc, raw: TailorAnswer, mode: TailorDraft["mode"]): TailorChange[] {
  const corpus = docPlainText(base);
  const contactIds = new Set(base.contacts.map((c) => c.id));
  const changes: TailorChange[] = [];
  const seen = new Set<string>();
  for (const edit of Array.isArray(raw.edits) ? raw.edits.slice(0, 16) : []) {
    const address = String(edit.id ?? "").replace(/[[\]\s]/g, "");
    if (!address || seen.has(address)) continue;
    const editable = address === "headline" || EDITABLE_FIELD.test(address) || (/^p\d+$/.test(address) && !contactIds.has(address));
    const before = editable ? textAt(base, address) : null;
    if (before === null) continue;
    // Read back through withText so the stored text and `after` are the same string.
    const after = textAt(withText(base, address, String(edit.text ?? "").replace(/^\s*[•·▪-]\s*/, "")), address) ?? "";
    if (!after || after === before) continue;
    const numbers = introducedNumbers(after, corpus);
    const terms = address === "headline" ? [] : introducedTerms(after, corpus);
    const flag = numbers.length
      ? `出现了原简历里没有的数字：${numbers.join("、")}`
      : terms.length
        ? `出现了原简历里没有的词：${terms.join("、")}`
        : undefined;
    seen.add(address);
    changes.push({ kind: "text", address, label: labelFor(base, address), before, after, reason: String(edit.reason ?? "").slice(0, 120), flag });
  }
  if (mode === "order") {
    const education = new Set(base.sections.filter((s) => /教育/.test(s.heading)).map((s) => s.id));
    for (const item of Array.isArray(raw.order) ? raw.order.slice(0, 10) : []) {
      const parent = String(item.parent ?? "").replace(/[<>\s]/g, "");
      const before = childrenOf(base, parent);
      const after = Array.isArray(item.children) ? item.children.map((id) => String(id).replace(/[[\]<>\s]/g, "")) : [];
      if (!before || education.has(parent) || seen.has(`order:${parent}`)) continue;
      if (after.length !== before.length || new Set(after).size !== after.length || !after.every((id) => before.includes(id))) continue;
      if (after.join(",") === before.join(",")) continue;
      seen.add(`order:${parent}`);
      changes.push({ kind: "order", parent, label: labelFor(base, parent), before, after, reason: String(item.reason ?? "").slice(0, 120) });
    }
  }
  return changes;
}

/** The base with every change applied except the held (flagged) ones. */
export function applyTailorChanges(base: ResumeDoc, changes: TailorChange[]): ResumeDoc {
  let doc = base;
  for (const change of changes) {
    if (change.kind === "text" && !change.flag) doc = withText(doc, change.address, change.after);
    if (change.kind === "order") doc = withOrder(doc, change.parent, change.after);
  }
  return doc;
}
