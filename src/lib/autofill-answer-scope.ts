/** Questions about a specific employer or role must stay scoped unless the
 * user explicitly changes their saved answer to "跨企业复用". */
export function companySpecificQuestion(label: string): boolean {
  return /公司|企业|岗位|职位|雇主|贵司|本司|加入我们|选择我们|为什么想来|为何想来|为何应聘|求职动机|why\s+(?:do\s+you\s+)?(?:want|apply|join|work|choose)|why\s+(?:us|our|this|here)|our company|this role|this position|interested in (?:us|our|this|the) (?:company|role|position|job)|what attracts you to/i.test(label);
}

/** A confirmed answer's sharing scope is an explicit user choice. Editing it
 * on another portal must create a new answer, not silently widen or rewrite it. */
export function canUpdateReferencedAnswer(
  existing: { confirmed: boolean; contextKey: string | null },
  desiredScope: string | null,
  currentContext: string | null,
): boolean {
  if (existing.confirmed) return existing.contextKey === desiredScope;
  return existing.contextKey === currentContext;
}

/** A different hand-written answer on a company page is a local variant,
 * even when the question wording itself is generic. */
export function shouldForkGlobalAnswer(
  existing: { contextKey: string | null; answer: string } | null,
  currentContext: string | null,
  nextAnswer: string,
): boolean {
  return !!(existing && existing.contextKey === null && currentContext && existing.answer !== nextAnswer);
}

/** Trims an AI essay cleanly to fit a page's maxLength when reasonable (>= 8 chars). */
export function fitAnswerToLimit(text: string, maxLength?: number): string {
  const clean = text.trim();
  if (!maxLength || clean.length <= maxLength) return clean;
  if (maxLength < 8) return "";
  const hard = Array.from(clean).slice(0, maxLength).join("");
  const sentence = Math.max(hard.lastIndexOf("。"), hard.lastIndexOf("！"), hard.lastIndexOf("？"), hard.lastIndexOf("\n"));
  if (sentence >= Math.floor(maxLength * 0.6)) return hard.slice(0, sentence + 1).trim();
  const clause = Math.max(hard.lastIndexOf("，"), hard.lastIndexOf("；"), hard.lastIndexOf(","), hard.lastIndexOf(";"), hard.lastIndexOf(" "));
  if (clause >= Math.floor(maxLength * 0.7)) return `${hard.slice(0, clause).trim()}。`.slice(0, maxLength);
  return hard.trim();
}

/** Matches an AI choice output against page dropdown options despite full-width/quote differences. */
export function matchChoiceOption(raw: string, options?: string[]): string | null {
  if (!options?.length) return null;
  if (options.includes(raw)) return raw;
  const norm = (s: string) => s.normalize("NFKC").replace(/^[「“"'(\[]|[」”"')\]。.]+$/g, "").trim().toLowerCase();
  const target = norm(raw);
  return options.find((opt) => norm(opt) === target) ?? null;
}
