import type { ApplicationStage } from "@prisma/client";
import { applicationCities } from "@/lib/application-city";
import { industryLabel } from "@/lib/company-industry";
import { STAGE_LABELS } from "@/lib/stage-labels";
import {
  applicationScheduleItems,
  currentStageRow,
  isTerminalStage,
  nextScheduleItem,
  type StageScheduleRow,
} from "@/lib/interview-schedule";

export type ExportFormat = "xlsx" | "csv" | "md";

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, { label: string; ext: string; mime: string }> = {
  xlsx: {
    label: "Excel 工作簿 (.xlsx)",
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  csv: {
    label: "CSV 表格 (.csv)",
    ext: "csv",
    mime: "text/csv; charset=utf-8",
  },
  md: {
    label: "Markdown 清单 (.md)",
    ext: "md",
    mime: "text/markdown; charset=utf-8",
  },
};

export type ApplicationExportSource = {
  id: string;
  title: string;
  appliedDate: Date | string;
  currentStage: ApplicationStage;
  currentStageLabel?: string | null;
  currentStageDate: Date | string;
  referrer?: string | null;
  source?: string | null;
  city?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  applyUrl?: string | null;
  jdSnapshotUrl?: string | null;
  portalStatus?: string | null;
  offerNote?: string | null;
  company: {
    name: string;
    industry?: string | null;
    sector?: string | null;
  };
  position?: {
    location?: string | null;
    jdUrl?: string | null;
  } | null;
  resumeVersion?: {
    name: string;
  } | null;
  stageHistory?: (StageScheduleRow & {
    enteredAt: Date | string;
    note?: string | null;
    terminatedAtStageLabel?: string | null;
    terminatedAtStage?: ApplicationStage | string | null;
  })[];
};

export type ApplicationExportRow = {
  id: string;
  companyName: string;
  title: string;
  industry: string;
  stage: ApplicationStage;
  stageDisplay: string;
  endedAt: string;
  cities: string;
  appliedDate: string;
  currentStageDate: string;
  nextSchedule: string;
  salaryRange: string;
  source: string;
  referrer: string;
  resumeName: string;
  portalStatus: string;
  applyUrl: string;
  historyTrail: string;
};

export type CompanyExportSummary = {
  companyName: string;
  industry: string;
  totalCount: number;
  activeCount: number;
  interviewCount: number;
  offerCount: number;
  endedCount: number;
  latestAppliedDate: string;
  latestStage: string;
  positionsSummary: string;
};

const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATETIME_FMT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatYmd(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return DATE_FMT.format(date);
}

function formatScheduleText(item: ReturnType<typeof nextScheduleItem>): string {
  if (!item) return "";
  const date = new Date(item.startsAt);
  if (Number.isNaN(date.getTime())) return item.title;
  const when = item.hasTime ? DATETIME_FMT.format(date) : formatYmd(date);
  return item.meetingInfo ? `${item.title} · ${when} (${item.meetingInfo})` : `${item.title} · ${when}`;
}

/** Prevents spreadsheet formula execution when opened in Excel / WPS / Numbers. */
export function sanitizeSpreadsheetCell(value: string): string {
  const clean = value.replace(/\r\n/g, "\n").trim();
  if (!clean) return "";
  return /^[=+\-@\t\r]/.test(clean) ? `'${clean}` : clean;
}

function csvCell(value: string): string {
  const safe = sanitizeSpreadsheetCell(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "—";
}

function formatSalary(min?: number | null, max?: number | null): string {
  if (min && max) return min === max ? `${min}K` : `${min}-${max}K`;
  if (min) return `${min}K+`;
  if (max) return `最高 ${max}K`;
  return "";
}

function stageText(stage: ApplicationStage, customLabel?: string | null): string {
  const base = STAGE_LABELS[stage] || stage;
  const label = customLabel?.trim();
  return label && label !== base ? `${base}（${label}）` : base;
}

const INTERVIEW_STAGES = new Set<ApplicationStage>([
  "INTERVIEW_1",
  "INTERVIEW_2",
  "INTERVIEW_3",
  "HR_INTERVIEW",
  "OFFER",
  "ACCEPTED",
  "DECLINED",
]);

const OFFER_STAGES = new Set<ApplicationStage>(["OFFER", "ACCEPTED", "DECLINED"]);

/** Normalizes DB or view application records into flat export rows. */
export function buildApplicationExportRows(
  records: ApplicationExportSource[],
  now = Date.now(),
): ApplicationExportRow[] {
  return records.map((app) => {
    const history = [...(app.stageHistory ?? [])].sort(
      (a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime(),
    );
    const current = history.length ? currentStageRow(app, history) : undefined;
    const schedule = history.length
      ? nextScheduleItem(
          applicationScheduleItems(
            {
              id: app.id,
              title: app.title,
              companyName: app.company.name,
              currentStage: app.currentStage,
              currentStageDate: app.currentStageDate,
            },
            history,
            now,
          ),
          now,
        )
      : null;

    const endedAt = current?.terminatedAtStageLabel?.trim()
      || (current?.terminatedAtStage ? (STAGE_LABELS as Record<string, string>)[current.terminatedAtStage] || current.terminatedAtStage : "")
      || "";

    const trail = history.map((row) => row.stageLabel?.trim() || STAGE_LABELS[row.stage] || row.stage).join(" -> ");
    const cities = applicationCities({
      city: app.city,
      location: app.position?.location,
      title: app.title,
      companyName: app.company.name,
    }).join("、");

    return {
      id: app.id,
      companyName: app.company.name.trim(),
      title: app.title.trim(),
      industry: industryLabel(app.company),
      stage: app.currentStage,
      stageDisplay: stageText(app.currentStage, app.currentStageLabel ?? current?.stageLabel),
      endedAt,
      cities,
      appliedDate: formatYmd(app.appliedDate),
      currentStageDate: formatYmd(app.currentStageDate),
      nextSchedule: formatScheduleText(schedule),
      salaryRange: formatSalary(app.salaryMin, app.salaryMax),
      source: app.source?.trim() || "",
      referrer: app.referrer?.trim() || "",
      resumeName: app.resumeVersion?.name?.trim() || "",
      portalStatus: app.portalStatus?.trim() || "",
      applyUrl: app.applyUrl?.trim() || app.jdSnapshotUrl?.trim() || app.position?.jdUrl?.trim() || "",
      historyTrail: trail,
    };
  });
}

/** Aggregates flat position rows by enterprise so users can scan applied companies at a glance. */
export function buildCompanySummaries(rows: ApplicationExportRow[]): CompanyExportSummary[] {
  const byCompany = new Map<string, ApplicationExportRow[]>();
  for (const row of rows) {
    const bucket = byCompany.get(row.companyName) ?? [];
    bucket.push(row);
    byCompany.set(row.companyName, bucket);
  }

  return [...byCompany.entries()]
    .map(([companyName, items]) => {
      const sorted = [...items].sort((a, b) => b.currentStageDate.localeCompare(a.currentStageDate));
      const latestAppliedDate = items.reduce(
        (latest, item) => (item.appliedDate > latest ? item.appliedDate : latest),
        "",
      );
      const activeCount = items.filter((item) => !isTerminalStage(item.stage)).length;
      const interviewCount = items.filter((item) => INTERVIEW_STAGES.has(item.stage)).length;
      const offerCount = items.filter((item) => OFFER_STAGES.has(item.stage)).length;
      const endedCount = items.length - activeCount;

      return {
        companyName,
        industry: sorted.find((item) => item.industry && item.industry !== "未分类")?.industry || sorted[0].industry || "未分类",
        totalCount: items.length,
        activeCount,
        interviewCount,
        offerCount,
        endedCount,
        latestAppliedDate,
        latestStage: sorted[0].stageDisplay,
        positionsSummary: sorted.map((item) => `${item.title}（${item.stageDisplay}）`).join("；"),
      };
    })
    .sort((a, b) => b.latestAppliedDate.localeCompare(a.latestAppliedDate) || b.totalCount - a.totalCount);
}

const POSITION_HEADERS = [
  "企业名称",
  "岗位名称",
  "所属行业",
  "当前阶段",
  "结束于",
  "工作城市",
  "投递日期",
  "阶段更新日期",
  "笔面试/截止安排",
  "薪资范围",
  "投递渠道",
  "内推人",
  "使用简历",
  "官网状态原文",
  "流程轨迹",
  "网申/岗位链接",
] as const;

function rowToCells(row: ApplicationExportRow): string[] {
  return [
    row.companyName,
    row.title,
    row.industry,
    row.stageDisplay,
    row.endedAt,
    row.cities,
    row.appliedDate,
    row.currentStageDate,
    row.nextSchedule,
    row.salaryRange,
    row.source,
    row.referrer,
    row.resumeName,
    row.portalStatus,
    row.historyTrail,
    row.applyUrl,
  ];
}

/** Generates a UTF-8 BOM RFC-4180 CSV with spreadsheet formula guards. */
export function applicationsToCsv(rows: ApplicationExportRow[]): string {
  const headerLine = POSITION_HEADERS.map(csvCell).join(",");
  const dataLines = rows.map((row) => rowToCells(row).map(csvCell).join(","));
  return `\uFEFF${[headerLine, ...dataLines].join("\r\n")}\r\n`;
}

/** Generates a portable Markdown report with both enterprise summary and position table. */
export function applicationsToMarkdown(rows: ApplicationExportRow[], scopeLabel?: string): string {
  const companies = buildCompanySummaries(rows);
  const active = rows.filter((row) => !isTerminalStage(row.stage)).length;
  const offers = rows.filter((row) => OFFER_STAGES.has(row.stage)).length;
  const exportedOn = formatYmd(new Date());

  const lines: string[] = [
    `# 已投递企业与岗位清单`,
    ``,
    `- 导出日期：${exportedOn}${scopeLabel ? ` · 范围：${scopeLabel}` : ""}`,
    `- 汇总统计：共 **${companies.length}** 家企业，**${rows.length}** 个岗位（进行中 ${active} 个 · Offer/已定 ${offers} 个）`,
    ``,
    `## 一、已投递企业汇总（${companies.length} 家）`,
    ``,
    `| 企业名称 | 行业 | 岗位数 | 进行中 | Offer | 最新进展 | 最近投递 | 已投岗位明细 |`,
    `| --- | --- | ---: | ---: | ---: | --- | --- | --- |`,
  ];

  for (const company of companies) {
    lines.push(
      `| ${mdCell(company.companyName)} | ${mdCell(company.industry)} | ${company.totalCount} | ${company.activeCount} | ${company.offerCount} | ${mdCell(company.latestStage)} | ${mdCell(company.latestAppliedDate)} | ${mdCell(company.positionsSummary)} |`,
    );
  }

  lines.push(
    ``,
    `## 二、已投递岗位明细（${rows.length} 条）`,
    ``,
    `| 企业名称 | 岗位名称 | 城市 | 当前阶段 | 投递日期 | 安排/官网状态 | 使用简历 | 链接 |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
  );

  for (const row of rows) {
    const extraStatus = [row.nextSchedule, row.portalStatus].filter(Boolean).join(" / ");
    const link = row.applyUrl ? `[打开链接](${row.applyUrl.replace(/[()]/g, "")})` : "—";
    lines.push(
      `| ${mdCell(row.companyName)} | ${mdCell(row.title)} | ${mdCell(row.cities)} | ${mdCell(row.stageDisplay)} | ${mdCell(row.appliedDate)} | ${mdCell(extraStatus)} | ${mdCell(row.resumeName)} | ${link} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/** Generates a 2-sheet Excel workbook (.xlsx) using lazy-loaded server-side exceljs. */
export async function applicationsToXlsxBuffer(rows: ApplicationExportRow[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CareerPlatform";
  workbook.created = new Date();

  const headerStyle = (sheet: import("exceljs").Worksheet) => {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    header.alignment = { vertical: "middle", horizontal: "left" };
    header.height = 24;
  };

  // Sheet 1: 投递岗位明细
  const detailSheet = workbook.addWorksheet("投递岗位明细", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const detailWidths = [22, 28, 12, 18, 14, 14, 13, 13, 24, 12, 12, 12, 18, 22, 32, 42];
  detailSheet.columns = POSITION_HEADERS.map((header, idx) => ({
    header,
    key: `c${idx}`,
    width: detailWidths[idx] ?? 18,
  }));
  for (const row of rows) {
    const safeCells = rowToCells(row).map(sanitizeSpreadsheetCell);
    const added = detailSheet.addRow(
      Object.fromEntries(safeCells.map((val, idx) => [`c${idx}`, val])),
    );
    added.alignment = { vertical: "middle", wrapText: false };
    const linkCell = added.getCell(POSITION_HEADERS.length);
    if (row.applyUrl && /^https?:\/\//i.test(row.applyUrl)) {
      linkCell.value = { text: row.applyUrl, hyperlink: row.applyUrl };
      linkCell.font = { color: { argb: "FF2563EB" }, underline: true };
    }
  }
  headerStyle(detailSheet);
  detailSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: POSITION_HEADERS.length },
  };

  // Sheet 2: 已投企业汇总
  const companies = buildCompanySummaries(rows);
  const summaryHeaders = [
    "企业名称",
    "所属行业",
    "已投岗位数",
    "进行中",
    "进入面试",
    "Offer/已定",
    "已结束",
    "最近投递日期",
    "最新进展",
    "已投岗位明细",
  ];
  const summaryWidths = [24, 14, 12, 10, 10, 11, 10, 14, 18, 48];
  const companySheet = workbook.addWorksheet("已投企业汇总", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  companySheet.columns = summaryHeaders.map((header, idx) => ({
    header,
    key: `s${idx}`,
    width: summaryWidths[idx] ?? 16,
  }));
  for (const company of companies) {
    const summaryCells = [
      sanitizeSpreadsheetCell(company.companyName),
      sanitizeSpreadsheetCell(company.industry),
      company.totalCount,
      company.activeCount,
      company.interviewCount,
      company.offerCount,
      company.endedCount,
      sanitizeSpreadsheetCell(company.latestAppliedDate),
      sanitizeSpreadsheetCell(company.latestStage),
      sanitizeSpreadsheetCell(company.positionsSummary),
    ];
    const added = companySheet.addRow(
      Object.fromEntries(summaryCells.map((val, idx) => [`s${idx}`, val])),
    );
    added.alignment = { vertical: "middle", wrapText: false };
  }
  headerStyle(companySheet);
  companySheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, companies.length + 1), column: summaryHeaders.length },
  };

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
