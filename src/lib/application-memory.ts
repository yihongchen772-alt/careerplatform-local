import { z } from "zod";
import { educationSchema, experienceSchema, projectSchema, awardSchema, type ApplicationProfile } from "@/lib/application-profile";

export const MEMORY_CATEGORIES = { education: "教育经历", experience: "实习 / 工作", project: "项目经历", award: "获奖情况" } as const;
export type MemoryCategory = keyof typeof MEMORY_CATEGORIES;
export type MemoryContent = Record<string, string>;
export const recordSchemas = { education: educationSchema, experience: experienceSchema, project: projectSchema, award: awardSchema };
const summarySchema = z.object({ text: z.string().trim().min(2).max(10000) });
export const memoryCaptureSchema = z.object({
  category: z.enum(["education", "experience", "project", "award"]),
  content: z.record(z.string().max(40), z.string().trim().max(10000)),
  captureKey: z.string().max(200).default(""),
}).superRefine((item, ctx) => {
  const parsed = item.content.text ? summarySchema.safeParse(item.content) : recordSchemas[item.category].safeParse(item.content);
  const anchor = item.category === "experience" ? "company" : item.category === "education" ? "school" : "name";
  if (!parsed.success || (!item.content.text && !item.content[anchor]?.trim())) ctx.addIssue({ code: "custom", message: "经历需要名称或整段原文，且每个字段须符合长度要求" });
});
export type MemoryCapture = z.infer<typeof memoryCaptureSchema>;
export type MemorySource = { url: string; captureKey: string };
export type MemoryAlternative = { content: MemoryContent; source: string };
export type MemoryView = { id: string; category: MemoryCategory; content: MemoryContent; sources: MemorySource[]; alternatives: MemoryAlternative[]; enabled: boolean; revision: number; updatedAt: string };

export function normalizeMemoryText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function memoryValueKey(key: string, value: string): string {
  const text = normalizeMemoryText(value);
  if (!["start", "end", "date"].includes(key)) return text;
  if (/^(?:至今|现在|目前|present|current|now)$/.test(text)) return "present";
  const match = /^(\d{4})(?:[年./-](\d{1,2})(?:月)?(?:[月./-](\d{1,2})(?:日)?)?)?$/.exec(text);
  if (!match) return text;
  return [match[1], match[2]?.padStart(2, "0"), match[3] && Number(match[3]) !== 1 ? match[3].padStart(2, "0") : ""].filter(Boolean).join("-");
}

function identityParts(category: MemoryCategory, content: MemoryContent) {
  const keys = category === "education" ? ["school", "degree", "start"]
    : category === "experience" ? ["company", "role", "start"]
    : category === "project" ? ["name", "start"] : ["name", "date"];
  return keys.map((key) => memoryValueKey(key, content[key] || ""));
}

export function memoryIdentity(category: MemoryCategory, content: MemoryContent): string {
  if (content.text) return "summary";
  return JSON.stringify(identityParts(category, content));
}

/** Partial records can be completed later, but incompatible dates/roles
 * distinguish two internships at the same employer. Callers require one match. */
export function sameMemoryEntity(category: MemoryCategory, a: MemoryContent, b: MemoryContent): boolean {
  if (a.text || b.text) return !!a.text && !!b.text;
  const x = identityParts(category, a), y = identityParts(category, b);
  return !!x[0] && x[0] === y[0] && x.every((value, i) => !value || !y[i] || value === y[i]);
}

/** Resume extraction supplements manual facts without replacing whole
 * sections. Incomplete identities merge only when the match is unique. */
export function mergeFactRows<T extends MemoryContent>(category: MemoryCategory, current: T[], extracted: T[], limit: number): T[] {
  const rows = current.map((row) => ({ ...row }));
  for (const incoming of extracted) {
    if (!Object.values(incoming).some(Boolean)) continue;
    const matches = rows.map((row, i) => sameMemoryEntity(category, row, incoming) ? i : -1).filter((i) => i >= 0);
    if (matches.length === 1) {
      const index = matches[0];
      rows[index] = { ...incoming, ...Object.fromEntries(Object.entries(rows[index]).filter(([, value]) => value)) } as T;
    } else if (!matches.length) rows.push({ ...incoming });
  }
  return rows.slice(0, limit);
}

export function memorySourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch { return ""; }
}

export function memoryContent(category: MemoryCategory, raw: unknown): MemoryContent | null {
  const parsed = raw && typeof raw === "object" && "text" in raw ? summarySchema.safeParse(raw) : recordSchemas[category]?.safeParse(raw);
  return parsed?.success ? parsed.data : null;
}

export function toMemoryView(row: { id: string; category: string; content: unknown; sources: unknown; alternatives: unknown; enabled: boolean; revision: number; updatedAt: Date }): MemoryView | null {
  const category = row.category as MemoryCategory;
  if (!Object.hasOwn(MEMORY_CATEGORIES, category)) return null;
  const content = memoryContent(category, row.content);
  if (!content) return null;
  const sources = z.array(z.object({ url: z.string(), captureKey: z.string() })).safeParse(row.sources);
  const alternatives = z.array(z.object({ content: z.record(z.string(), z.string()), source: z.string() })).safeParse(row.alternatives);
  return { id: row.id, category, content, sources: sources.success ? sources.data : [], alternatives: alternatives.success ? alternatives.data : [], enabled: row.enabled, revision: row.revision, updatedAt: row.updatedAt.toISOString() };
}

/** Fill missing facts only. Contradictory versions are kept separately and
 * never silently replace the currently selected description. */
export function mergeMemoryContent(category: MemoryCategory, current: MemoryContent, incoming: MemoryContent, alternatives: MemoryAlternative[], source: string) {
  const content = { ...current };
  let conflict = false;
  for (const [key, value] of Object.entries(incoming)) {
    if (!value) continue;
    if (!content[key]) content[key] = value;
    else if (memoryValueKey(key, content[key]) !== memoryValueKey(key, value)) conflict = true;
  }
  const next = alternatives.filter((version) => memoryContent(category, version.content));
  const alreadyKnown = next.some((version) => Object.entries(incoming).every(([key, value]) => !value || memoryValueKey(key, version.content[key] || "") === memoryValueKey(key, value)));
  if (conflict && !alreadyKnown) next.push({ content: { ...content, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value)) }, source });
  return { content, alternatives: next.slice(-5), conflict: conflict && !alreadyKnown };
}

/** Explicit direction variants retain their chosen internships/projects.
 * Default facts get the enabled library appended, without duplicate entities. */
export function profileWithMemories(profile: ApplicationProfile, memories: MemoryView[], hasVariant: boolean): ApplicationProfile {
  const result = { ...profile, education: [...profile.education], experiences: [...profile.experiences], projects: [...profile.projects], awards: [...profile.awards] };
  for (const memory of memories) {
    if (!memory.enabled || memory.content.text || (hasVariant && ["experience", "project"].includes(memory.category))) continue;
    const list = memory.category === "experience" ? "experiences" : memory.category === "project" ? "projects" : memory.category === "award" ? "awards" : "education";
    const rows = result[list] as MemoryContent[];
    const matches = rows.map((row, i) => sameMemoryEntity(memory.category, row, memory.content) ? i : -1).filter((i) => i >= 0);
    if (matches.length === 1) rows[matches[0]] = { ...memory.content, ...Object.fromEntries(Object.entries(rows[matches[0]]).filter(([, value]) => value)) };
    else if (!matches.length && rows.length < (list === "education" ? 10 : list === "awards" ? 30 : 20)) rows.push({ ...memory.content });
  }
  return result;
}
