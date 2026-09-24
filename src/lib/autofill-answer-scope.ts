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
