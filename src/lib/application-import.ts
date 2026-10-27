import { cityText, parseCities } from "@/lib/application-city";

/**
 * Reading the applicant's own tracking sheet (the Excel almost everyone has
 * by the time they open this app) into 投递 rows. No AI: a header row with a
 * 公司 column is enough, the rest is matched by name.
 */
export type ImportedApplication = {
  companyName: string;
  title: string;
  city: string | null;
  /** YYYY-MM-DD, or null when the sheet has none (then the import day). */
  appliedDate: string | null;
  stage: ImportStage;
  /** What the sheet said, shown next to the stage it was read as. */
  statusText: string;
  source: string | null;
  note: string | null;
  applyUrl: string | null;
};

export type ImportStage =
  | "APPLIED"
  | "SCREENING"
  | "ASSESSMENT"
  | "OA"
  | "INTERVIEW_1"
  | "INTERVIEW_2"
  | "INTERVIEW_3"
  | "HR_INTERVIEW"
  | "OFFER"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

export const IMPORT_STAGES: ImportStage[] = ["APPLIED", "SCREENING", "ASSESSMENT", "OA", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN"];

export const MAX_IMPORT_ROWS = 300;

type Field = "companyName" | "title" | "city" | "appliedDate" | "status" | "source" | "note" | "applyUrl";
type HeaderField = Field | "ignore";

// Specific names first: 「投递日期」 must not be read as the 投递状态 column.
const HEADERS: [RegExp, HeaderField][] = [
  [/^(公司|企业|单位)(行业|性质|类型|规模|地址|简介|官网)/, "ignore"],
  [/^(投递|申请|网申|应聘)?(日期|时间)$/, "appliedDate"],
  [/^(投递|申请|网申|应聘)(日期|时间)/, "appliedDate"],
  [/^(公司|企业|单位)(名称|名)?$/, "companyName"],
  [/^(公司|企业|单位)/, "companyName"],
  [/^(应聘|投递|申请|招聘)?(岗位|职位)(名称|名)?$/, "title"],
  [/^(岗位|职位)/, "title"],
  [/^(工作)?(城市|地点|地区|base)$/i, "city"],
  [/^(工作)?(城市|地点)/, "city"],
  [/^(当前|目前|最新)?(状态|进度|进展|结果|阶段)/, "status"],
  [/^(投递|申请)(状态|进度)/, "status"],
  [/^(渠道|投递方式|方式|来源|途径)/, "source"],
  [/^(链接|网址|投递链接|申请链接|官网)/, "applyUrl"],
  [/^(备注|说明|笔记|面经|情况)/, "note"],
];

/** The stage a free-text status means. 「挂 / 未通过」 wins over the round it happened in. */
export function stageFromStatus(raw: string): ImportStage | "SKIP" {
  const text = raw.trim();
  if (!text) return "APPLIED";
  if (/待投|未投|没投|准备投|还没投|收藏|想投|计划投/.test(text)) return "SKIP";
  if (/接受|签约|签了|已签|三方/.test(text)) return "ACCEPTED";
  if (/放弃|撤回|不投了|拒(?:绝)?了?\s*offer/i.test(text)) return "WITHDRAWN";
  if (/挂|未通过|没通过|不通过|被拒|拒绝|淘汰|凉|感谢信|被刷|不合适|没过|失败/.test(text)) return "REJECTED";
  if (/offer|录用|录取|意向书|拿到/i.test(text)) return "OFFER";
  if (/hr\s*面|hrbp面|人事面/i.test(text)) return "HR_INTERVIEW";
  if (/三面|终面|最后一面|总监面|交叉面|(?:^|\D)3\s*面/.test(text)) return "INTERVIEW_3";
  if (/二面|复试|(?:^|\D)2\s*面/.test(text)) return "INTERVIEW_2";
  if (/一面|初面|面试|面谈|(?:^|\D)1\s*面|群面|电话面/.test(text)) return "INTERVIEW_1";
  if (/笔试|OA|在线考试|机考/i.test(text)) return "OA";
  if (/测评|测试|性格|游戏|素质/.test(text)) return "ASSESSMENT";
  if (/筛选|评估|审核|简历|等通知|排队|处理中/.test(text)) return "SCREENING";
  return "APPLIED";
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date as a sheet writes it. Without a year the most recent such day that is
 * not in the future (an application is never from next month).
 */
export function parseSheetDate(raw: string, now = new Date()): string | null {
  const text = raw.trim();
  if (!text) return null;
  // Excel's own day numbers (45567 = 2024-10-01), when a date cell came through as a number.
  if (/^\d{5}$/.test(text)) {
    const ms = Date.UTC(1899, 11, 30) + Number(text) * 86_400_000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const full = text.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (full) return valid(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = text.match(/(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (short) {
    const month = Number(short[1]);
    const day = Number(short[2]);
    let year = now.getFullYear();
    if (valid(year, month, day) && new Date(year, month - 1, day).getTime() > now.getTime() + 7 * 86_400_000) year -= 1;
    return valid(year, month, day);
  }
  return null;
}

function valid(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export type ApplicationSheet = { rows: ImportedApplication[]; skipped: number; truncated: boolean };

/**
 * Maps a sheet's rows, or null when no header row names a company (so the
 * caller can say what is missing instead of guessing). A row needs a company;
 * without a 岗位 column the title is 「未注明岗位」. Rows marked as not yet
 * applied are skipped and counted.
 */
export function mapApplicationRows(cells: string[][], now = new Date()): ApplicationSheet | null {
  let headerAt = -1;
  let columns: (Field | null)[] = [];
  for (let i = 0; i < Math.min(cells.length, 8); i++) {
    const candidate = cells[i].map((cell) => {
      const name = cell.trim().replace(/[\s（(].*$/, "");
      const field = name ? HEADERS.find(([pattern]) => pattern.test(name))?.[1] ?? null : null;
      return field === "ignore" ? null : field;
    });
    if (candidate.includes("companyName")) {
      headerAt = i;
      columns = candidate;
      break;
    }
  }
  if (headerAt < 0) return null;

  const rows: ImportedApplication[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const cellsOfRow of cells.slice(headerAt + 1)) {
    const record: Partial<Record<Field, string>> = {};
    columns.forEach((field, index) => {
      const value = (cellsOfRow[index] ?? "").trim();
      if (!field || !value) return;
      record[field] = record[field] && field === "note" ? `${record[field]}；${value}` : record[field] ?? value;
    });
    const companyName = record.companyName?.trim();
    if (!companyName) continue;
    const statusText = record.status ?? "";
    const stage = stageFromStatus(statusText);
    if (stage === "SKIP") { skipped++; continue; }
    const title = (record.title ?? "").trim().slice(0, 120) || "未注明岗位";
    const key = `${companyName.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const cities = parseCities(record.city ?? "");
    rows.push({
      companyName: companyName.slice(0, 80),
      title,
      city: cities.length ? cityText(cities).slice(0, 40) : null,
      appliedDate: parseSheetDate(record.appliedDate ?? "", now),
      stage,
      statusText,
      source: record.source?.slice(0, 60) ?? null,
      note: record.note?.slice(0, 500) ?? null,
      applyUrl: record.applyUrl && /^https?:\/\//i.test(record.applyUrl) ? record.applyUrl.slice(0, 2000) : null,
    });
  }
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), skipped, truncated: rows.length > MAX_IMPORT_ROWS };
}

export const IMPORT_STAGE_LABELS: Record<ImportStage, string> = {
  APPLIED: "已投递",
  SCREENING: "筛选中",
  ASSESSMENT: "测评",
  OA: "笔试",
  INTERVIEW_1: "一面",
  INTERVIEW_2: "二面",
  INTERVIEW_3: "三面",
  HR_INTERVIEW: "HR 面",
  OFFER: "Offer",
  ACCEPTED: "已接受",
  REJECTED: "未通过",
  WITHDRAWN: "已放弃",
};
