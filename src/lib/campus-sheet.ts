/**
 * A subscribed 校招信息表's rows, turned into CampusPosting fields. Pure, so
 * it can be tested without the database. The sheets these come from are
 * made by people, so columns are found by name ("公司", "工作地点", "截止日期"…)
 * and helper options someone put in a select column ("先看必读文档") are dropped.
 */

export type SheetRow = { id: string; cells: Record<string, string> };

export type PostingFields = {
  externalId: string;
  company: string;
  roles: string | null;
  cohort: string | null;
  kind: string | null;
  cities: string | null;
  industry: string | null;
  degree: string | null;
  writtenTest: string | null;
  applyUrl: string | null;
  noticeUrl: string | null;
  startDate: Date | null;
  deadline: Date | null;
  deadlineText: string | null;
  note: string | null;
  salary: string | null;
};

type Key = Exclude<keyof PostingFields, "externalId" | "deadline"> | "highlight";

// More specific names first: 「公司行业」 must not be read as the company.
const COLUMNS: [RegExp, Key][] = [
  [/^(公司行业|所属行业|行业)/, "industry"],
  [/^(公司类型|企业性质|公司性质)/, "industry"],
  [/^(公司|企业|单位)(名称|全称)?$/, "company"],
  [/^(届次|届别|毕业届|届数|面向届)/, "cohort"],
  [/^(招聘类型|招聘批次|类型)/, "kind"],
  [/^(岗位|职位|招聘岗位|岗位方向|招聘职位)/, "roles"],
  [/^(工作地点|工作城市|地点|城市|base)/i, "cities"],
  [/^(学历要求|学历)/, "degree"],
  [/笔试/, "writtenTest"],
  [/^(投递链接|网申链接|申请链接|投递地址|网申地址|投递方式)/, "applyUrl"],
  [/^(公告链接|公告|原文链接|招聘公告)/, "noticeUrl"],
  [/^(开始时间|开始日期|发布时间|发布日期|更新时间|更新日期)/, "startDate"],
  [/^(截止日期|截止时间|投递截止|截止)/, "deadlineText"],
  [/^(薪资|待遇|薪酬)/, "salary"],
  [/^(招聘亮点|亮点|福利)/, "highlight"],
  [/^(备注|说明)/, "note"],
];

// Options a sheet's owner put in a select to explain the filter, not values.
const HELPER_OPTION = /必读|筛选|别选|选择包括|先看|说明/;

export function columnKey(name: string): Key | null {
  const clean = name.trim();
  return COLUMNS.find(([pattern]) => pattern.test(clean))?.[1] ?? null;
}

function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s，,；;）)】」"']+/)?.[0] ?? null;
}

function cleanList(text: string): string | null {
  const items = text.split(/[、,，;；\n]+/).map((item) => item.trim()).filter((item) => item && !HELPER_OPTION.test(item));
  return items.length ? [...new Set(items)].join("、") : null;
}

/** "2026-09-03", "2026/9/3", "2026年9月3日" as a local calendar day. */
export function parseDay(text: string | null | undefined): Date | null {
  const match = (text ?? "").match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day.getTime()) ? null : day;
}

/**
 * A deadline as written in these sheets: "10.15", "11月15日", "2026-10-31";
 * "招满即停" and the like have none. A month and day with no year belong to
 * the season the row was posted in — the first such day on or after its start.
 */
export function parseSheetDeadline(text: string | null | undefined, start: Date | null, now = new Date()): Date | null {
  const value = (text ?? "").trim();
  if (!value || /招满|即止|即停|长期|滚动|不限|待定|另行/.test(value) && !/\d/.test(value)) return null;
  const full = parseDay(value);
  if (full) return full;
  const md = value.match(/(?<!\d)(\d{1,2})\s*[.月/-]\s*(\d{1,2})(?!\d)/);
  if (!md) return null;
  const month = Number(md[1]);
  const date = Number(md[2]);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  const from = start ?? now;
  let day = new Date(from.getFullYear(), month - 1, date);
  if (day < new Date(from.getFullYear(), from.getMonth(), from.getDate())) day = new Date(from.getFullYear() + 1, month - 1, date);
  return day;
}

export function mapSheetRow(row: SheetRow, now = new Date()): PostingFields | null {
  const values: Partial<Record<Key, string>> = {};
  for (const [column, raw] of Object.entries(row.cells)) {
    const key = columnKey(column);
    const value = String(raw ?? "").trim();
    if (!key || !value) continue;
    values[key] = values[key] ? `${values[key]}；${value}` : value;
  }
  const company = values.company?.split(/\n/)[0].trim().slice(0, 120);
  if (!company) return null;
  const applyText = values.applyUrl ?? "";
  const applyUrl = firstUrl(applyText);
  const startDate = parseDay(values.startDate);
  const text = (value: string | undefined, max: number) => (value ? value.replace(/\n{2,}/g, "\n").trim().slice(0, max) || null : null);
  // 投递方式 written out ("邮箱投递 hr@…") is kept with the notes when it has no link.
  const note = [values.highlight, values.note, applyText && !applyUrl ? `投递方式：${applyText}` : ""].filter(Boolean).join("\n");
  return {
    externalId: row.id,
    company,
    roles: text(values.roles, 2000),
    cohort: values.cohort ? cleanList(values.cohort) : null,
    kind: values.kind ? cleanList(values.kind) : null,
    cities: values.cities ? cleanList(values.cities) : null,
    industry: values.industry ? cleanList(values.industry) : null,
    degree: values.degree ? cleanList(values.degree) : null,
    writtenTest: values.writtenTest ? cleanList(values.writtenTest) : null,
    applyUrl: applyUrl ?? firstUrl(values.noticeUrl ?? ""),
    noticeUrl: firstUrl(values.noticeUrl ?? ""),
    startDate,
    deadline: parseSheetDeadline(values.deadlineText, startDate, now),
    deadlineText: text(values.deadlineText, 60),
    note: text(note, 2000),
    salary: text(values.salary, 200),
  };
}

/** Whether a sync changes anything about a stored row. */
export function samePosting(a: Omit<PostingFields, "externalId">, b: Omit<PostingFields, "externalId">): boolean {
  const keys = Object.keys(a) as (keyof typeof a)[];
  return keys.every((key) => {
    const x = a[key];
    const y = b[key];
    if (x instanceof Date || y instanceof Date) return (x instanceof Date ? x.getTime() : null) === (y instanceof Date ? y.getTime() : null);
    return (x ?? null) === (y ?? null);
  });
}

/** "2027届" from a graduation year, for 「只看我的届次」. */
export function cohortLabel(graduationYear: number | null | undefined): string | null {
  return graduationYear && graduationYear > 2000 ? `${graduationYear}届` : null;
}
