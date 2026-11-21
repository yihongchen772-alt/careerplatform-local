/**
 * The record lines a tool returned (「- [投递ID:x][进度ID:y] 公司 · 岗位；…」), one per
 * record and cut short: enough for the next turn to act on them by ID.
 */
const REF_LINE = /\[(?:投递|岗位|进度|日程|邮件待办|待办|线索|简历|联系人)ID:[^\]\n]{1,60}\][^\n]*/g;
const REF_JSON = /"(投递ID|岗位ID|进度ID|待办ID|线索ID|简历ID|联系人ID)":\s*"([^"]{1,60})"/g;

const SEARCH_ARRAY_LABELS: Record<string, string> = {
  applications: "投递ID",
  positions: "岗位ID",
  leads: "线索ID",
  tasks: "待办ID",
  resumes: "简历ID",
  contacts: "联系人ID",
};

export function collectRefs(into: Map<string, string>, content: string) {
  for (const match of content.matchAll(REF_LINE)) {
    if (into.size >= 40) return;
    const line = match[0].replace(/\s+/g, " ").slice(0, 90);
    const key = /ID:([^\]]+)\]/.exec(line)?.[1] ?? line;
    if (!into.has(key)) into.set(key, `- ${line}`);
  }
  for (const match of content.matchAll(REF_JSON)) {
    if (into.size >= 40) return;
    if (!into.has(match[2])) into.set(match[2], `- [${match[1]}:${match[2]}]`);
  }
  // search_records returns plain JSON objects with `{ id, company, title, name }`;
  // capture those IDs too so the next turn doesn't have to re-search.
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.includes('"id"')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [field, idLabel] of Object.entries(SEARCH_ARRAY_LABELS)) {
        const list = parsed[field];
        if (!Array.isArray(list)) continue;
        for (const row of list) {
          if (into.size >= 40) return;
          if (!row || typeof row !== "object") continue;
          const rec = row as Record<string, unknown>;
          const id = typeof rec.id === "string" ? rec.id.trim() : "";
          if (!id || into.has(id)) continue;
          const desc = [rec.company, rec.title, rec.name].filter((v): v is string => typeof v === "string" && !!v.trim()).join(" · ");
          into.set(id, `- [${idLabel}:${id}]${desc ? ` ${desc.slice(0, 60)}` : ""}`);
        }
      }
    } catch {
      // Not pure JSON; regex passes above already extracted inline refs.
    }
  }
}
