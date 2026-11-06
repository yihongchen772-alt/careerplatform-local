/** The company a mail 待办 is about, from its title 「面试邀请：宝洁」. */
export function companyOf(title: string): string | undefined {
  return /^[^：]+：(.+)$/.exec(title)?.[1]?.trim() || undefined;
}

const companyKey = (title: string) => (companyOf(title) ?? "").normalize("NFKC").toLowerCase().replace(/\([^)]*\)/g, "").replace(/(?:股份)?有限公司|集团|公司$|\s+/g, "");

/** 「星海」 and 「星海（北京分部）」, 「星海科技」 and 「星海科技（上海）有限公司」: one sender. */
export function sameMailCompany(a: string, b: string): boolean {
  const [x, y] = [companyKey(a), companyKey(b)];
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
}
