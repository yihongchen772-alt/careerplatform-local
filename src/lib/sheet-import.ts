import { UserFacingError } from "@/lib/action-result";

/**
 * Pure spreadsheet parsing — deliberately NOT a "use server" module, so the
 * sync helpers here can be shared between the upload route handler and the
 * Server Actions. (A "use server" file may only export async functions.)
 */
export type ImportedPosition = {
  companyName?: string | null;
  title?: string | null;
  track?: string | null;
  department?: string | null;
  location?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  deadline?: string | null;
  source?: string | null;
  jdUrl?: string | null;
  note?: string | null;
};

/** Free-form sheets go to an AI; keep that one call bounded. */
export const MAX_ROWS = 60;
export const MAX_CHARS = 24000;

/**
 * Upper bound for the no-AI header-mapped path. Real sheets run to thousands
 * of rows (a measured one: 9840 x 19), but a preview with thousands of
 * checkboxes is unusable and the payload gets unwieldy. The UI reports when
 * it truncated so the user knows to trim and re-import.
 */
export const MAX_MAPPED_ROWS = 200;

/**
 * Header-name -> field mapping for sheets that already have a header row.
 * Order matters: the more specific patterns must come first, or "公司行业"
 * would be swallowed by the "公司" rule and land in companyName.
 */
const HEADER_MAP: [RegExp, keyof ImportedPosition | "salary"][] = [
  [/^(公司行业|行业|所属行业)/, "track"],
  [/^(招聘类型|岗位类型|职位类别|类别|方向)/, "track"],
  [/^(公司|企业|单位)(名称)?$/, "companyName"],
  [/^(公司|企业|单位)/, "companyName"],
  [/^(岗位|职位)(名称)?$/, "title"],
  [/^(招聘岗位|岗位|职位)/, "title"],
  [/^(部门|事业群|事业部|所属部门)/, "department"],
  [/^(工作地点|工作城市|地点|城市|base)/i, "location"],
  [/^(截止日期|投递截止|截止|deadline)/i, "deadline"],
  [/^(薪资|待遇|月薪|年薪|薪酬)/, "salary"],
  [/^(投递链接|申请链接|网申|公告链接|链接)/, "jdUrl"],
  [/^(投递方式|渠道|方式|来源)/, "source"],
  [/^(备注|说明|招聘亮点|学历要求|要求|亮点)/, "note"],
];

export function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Rich text, hyperlink and formula cells each carry their display value
    // under a different key; without this they stringify to "[object Object]".
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if ("text" in o) return String(o.text ?? "");
    if ("hyperlink" in o) return String(o.hyperlink ?? "");
    if ("result" in o) return String(o.result ?? "");
    return "";
  }
  return String(v);
}

/** Parses "25-40K" / "20k-30k/月" / "面议" into min/max in K. */
export function parseSalary(raw: string): { min: number | null; max: number | null } {
  const range = raw.match(/(\d+(?:\.\d+)?)\s*[kK]?\s*[-~到至]\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Math.round(Number(range[1])), max: Math.round(Number(range[2])) };
  const one = raw.match(/(\d+(?:\.\d+)?)\s*[kK]/);
  if (one) return { min: Math.round(Number(one[1])), max: null };
  return { min: null, max: null };
}

/** Normalises assorted date spellings to YYYY-MM-DD, or null when open-ended. */
export function parseDeadline(raw: string): string | null {
  const t = raw.trim();
  if (!t || /招满|长期|不限|滚动|随时|持续|另行/.test(t)) return null;
  const iso = t.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const md = t.match(/(\d{1,2})[-/.月](\d{1,2})/);
  if (md) {
    // No year given: pick the next occurrence, same rule the AI path uses.
    const now = new Date();
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = now.getFullYear();
    if (new Date(year, month - 1, day) < now) year += 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Maps rows straight from a labelled header, or returns null when no header
 * is recognisable (needs at least a company and a title column), in which
 * case the caller falls back to the AI path.
 */
export function mapByHeader(rows: string[][]): ImportedPosition[] | null {
  if (rows.length < 2) return null;

  // The header is often not row 1 — these sheets tend to open with a banner
  // and a couple of note rows — so scan the first several.
  let headerIdx = -1;
  let mapping: (keyof ImportedPosition | "salary" | null)[] = [];
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const candidate = rows[i].map((h) => {
      const name = h.trim();
      if (!name) return null;
      return HEADER_MAP.find(([re]) => re.test(name))?.[1] ?? null;
    });
    if (candidate.includes("companyName") && candidate.includes("title")) {
      headerIdx = i;
      mapping = candidate;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const out: ImportedPosition[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const rec: Record<string, string> = {};
    mapping.forEach((field, col) => {
      if (!field) return;
      const value = (row[col] ?? "").trim();
      if (!value) return;
      // Several source columns can feed the same field (notably note); keep
      // all of them rather than letting the last one win.
      rec[field] = rec[field] ? `${rec[field]}；${value}` : value;
    });

    const companyName = rec.companyName?.trim();
    const title = rec.title?.trim();
    if (!companyName || !title) continue;

    const salary = parseSalary(rec.salary ?? "");
    out.push({
      companyName,
      title,
      track: rec.track ?? null,
      department: rec.department ?? null,
      location: rec.location ?? null,
      salaryMin: salary.min,
      salaryMax: salary.max,
      deadline: parseDeadline(rec.deadline ?? ""),
      source: rec.source ?? null,
      jdUrl: rec.jdUrl?.startsWith("http") ? rec.jdUrl : null,
      note: rec.note ?? null,
    });
  }
  return out.length > 0 ? out : null;
}

function spreadsheetKind(filename: string): "csv" | "excel" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "excel";
  return null;
}

/** Reads an .xlsx/.csv into raw cell rows, for header mapping to try first. */
export async function sheetToRows(buffer: Buffer, filename: string): Promise<string[][]> {
  const kind = spreadsheetKind(filename);
  if (kind === "csv") {
    const sep = filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    return buffer
      .toString("utf8")
      .split(/\r?\n/)
      .slice(0, MAX_MAPPED_ROWS + 10)
      .map((line) => line.split(sep).map((c) => c.replace(/^"|"$/g, "")));
  }
  if (kind === "excel") {
    // Imported lazily: exceljs is a heavy, server-only dependency.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    // First sheet only: these workbooks routinely carry extra tabs of
    // instructions and ads that would otherwise be read as positions.
    const sheet = wb.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      if (rows.length > MAX_MAPPED_ROWS + 10) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c) => cells.push(cellToString(c.value)));
      rows.push(cells);
    });
    return rows;
  }
  throw new UserFacingError("只支持 Excel（.xlsx/.xls）或 CSV 文件");
}

/** Flattens a sheet to pipe-delimited text, for the AI fallback path. */
export async function sheetToText(buffer: Buffer, filename: string): Promise<string> {
  const rows = await sheetToRows(buffer, filename);
  const lines = rows
    .slice(0, MAX_ROWS + 5)
    .map((cells) => cells.join(" | "))
    .filter((line) => line.replace(/[\s|]/g, "").length > 0);
  if (lines.length === 0) throw new UserFacingError("这个表格里没读到任何内容");
  return lines.join("\n").slice(0, MAX_CHARS);
}
