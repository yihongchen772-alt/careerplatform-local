/**
 * The record lines a tool returned (「- [投递ID:x][进度ID:y] 公司 · 岗位；…」), one per
 * record and cut short: enough for the next turn to act on them by ID.
 */
const REF_LINE = /\[(?:投递|岗位|进度|日程|邮件待办|联系人)ID:[^\]\n]{1,60}\][^\n]*/g;
const REF_JSON = /"(投递ID|岗位ID|进度ID)":\s*"([^"]{1,60})"/g;
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
}
