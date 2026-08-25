"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { getResumeContext } from "@/lib/resume-context";
import { computeInterestScore } from "@/lib/scoring";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

/**
 * These sheets circulate in group chats with wildly inconsistent columns
 * ("公司"/"企业名称"/"公司名", 投递截止 as "10.15"/"10月15日"/"长期有效"),
 * so the columns are not parsed by rule — the rows are flattened to text and
 * an AI maps them onto our fields. Everything lands in a preview the user
 * confirms; nothing is written until they do.
 */
const rowSchema = z.object({
  companyName: z.string().nullish(),
  title: z.string().nullish(),
  track: z.string().nullish(),
  department: z.string().nullish(),
  location: z.string().nullish(),
  salaryMin: z.number().nullish(),
  salaryMax: z.number().nullish(),
  deadline: z.string().nullish(),
  source: z.string().nullish(),
  jdUrl: z.string().nullish(),
  note: z.string().nullish(),
});

const extractionSchema = z.object({ positions: z.array(rowSchema) });

export type ImportedPosition = z.infer<typeof rowSchema>;

/** Sheets in group chats get long; keep one AI call bounded. */
const MAX_ROWS = 60;
const MAX_CHARS = 24000;

function looksLikeHeaderOrBlank(cells: string[]): boolean {
  const joined = cells.join("").trim();
  if (!joined) return true;
  return /^(序号|公司|企业|岗位|职位|城市|地点|投递|截止|链接|备注|批次|类型|状态)/.test(
    cells[0] ?? ""
  ) && cells.length > 1;
}

/** Renders a spreadsheet buffer as pipe-delimited text rows for the model. */
async function sheetToText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const text = buffer.toString("utf8");
    return text.split(/\r?\n/).slice(0, MAX_ROWS + 5).join("\n").slice(0, MAX_CHARS);
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    // Imported lazily: exceljs is a heavy, server-only dependency and most
    // requests through this module never touch a spreadsheet.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    const lines: string[] = [];
    wb.eachSheet((sheet) => {
      if (lines.length > MAX_ROWS + 5) return;
      sheet.eachRow((row) => {
        if (lines.length > MAX_ROWS + 5) return;
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.value;
          if (v == null) cells.push("");
          else if (typeof v === "object" && "text" in v) cells.push(String(v.text));
          else if (typeof v === "object" && "hyperlink" in v)
            cells.push(String((v as { hyperlink: string }).hyperlink));
          else if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
          else cells.push(String(v));
        });
        if (!looksLikeHeaderOrBlank(cells) || lines.length === 0) {
          lines.push(cells.join(" | "));
        }
      });
    });
    if (lines.length === 0) throw new UserFacingError("这个表格里没读到任何内容");
    return lines.join("\n").slice(0, MAX_CHARS);
  }

  throw new UserFacingError("只支持 Excel（.xlsx/.xls）或 CSV 文件");
}

export async function parseRecruitmentSheet(
  fileBase64: string,
  filename: string
): Promise<ActionResult<{ positions: ImportedPosition[]; truncated: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();

    const config = await getUserAiConfig(user.id);
    if (!config) {
      throw new UserFacingError("先去账号设置配置一个 AI Key 才能解析信息表");
    }

    const buffer = Buffer.from(fileBase64, "base64");
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new UserFacingError("文件不能超过 10MB");
    }

    const sheetText = await sheetToText(buffer, filename);
    const truncated = sheetText.length >= MAX_CHARS;

    // The model has no clock, so a bare "10.15" gets a guessed (usually
    // training-era, i.e. past) year — which would make every imported
    // deadline look long overdue to the reminder logic. Give it today.
    const today = new Date().toISOString().slice(0, 10);

    const prompt = `下面是一份秋招信息表的原始内容（每行是表格的一行，单元格用 | 分隔）。请把它整理成结构化的岗位列表。

今天的日期是 ${today}。

原始内容：
${sheetText}

要求：
- 每个岗位一条记录；表头行、说明行、空行直接跳过，不要当成岗位
- companyName：公司名称。如果整张表都是同一家公司的不同岗位，每条都要填上公司名
- title：岗位名称
- track：技术/业务方向，比如"后端开发""算法""产品经理"，看不出来填 null
- department：所属部门/事业群，没写就填 null
- location：工作城市
- salaryMin / salaryMax：月薪，统一换算成以"K"（千元）为单位的**数字**。写年薪的换算成月薪；写"面议"或没写就填 null
- deadline：投递截止日期，统一整理成 YYYY-MM-DD 格式的字符串。只写了"10.15"或"10月15日"这种没有年份的，**以今天 ${today} 为准补全成之后最近的那个日期**（比如今天是 2026-08-25、原文写 10.15，就是 2026-10-15，不是 2025-10-15）。"长期有效"/"滚动招聘"这类没有具体日期的填 null
- source：投递渠道，比如"官网""内推""BOSS直聘"，没写填 null
- jdUrl：投递链接，只在原文里确实有网址时填，否则 null
- note：其他值得保留的信息（比如"仅限硕士""base 新加坡""需笔试"），没有就填 null
- 表里没有的信息一律填 null，绝对不要编造公司名、日期或链接
- 最多返回 ${MAX_ROWS} 条`;

    const raw = await callTextAi({
      config,
      prompt,
      thinkingBudget: 1024,
      timeoutMs: 120000,
      schema: {
        type: "OBJECT",
        properties: {
          positions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                companyName: { type: "STRING", nullable: true },
                title: { type: "STRING", nullable: true },
                track: { type: "STRING", nullable: true },
                department: { type: "STRING", nullable: true },
                location: { type: "STRING", nullable: true },
                salaryMin: { type: "NUMBER", nullable: true },
                salaryMax: { type: "NUMBER", nullable: true },
                deadline: { type: "STRING", nullable: true },
                source: { type: "STRING", nullable: true },
                jdUrl: { type: "STRING", nullable: true },
                note: { type: "STRING", nullable: true },
              },
              required: ["companyName", "title"],
            },
          },
        },
        required: ["positions"],
      },
    });

    const parsed = extractionSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

    // A row with neither company nor title is noise the model failed to skip.
    const positions = parsed.data.positions.filter((p) => p.companyName || p.title);
    if (positions.length === 0) {
      throw new UserFacingError("没从这个表格里认出任何岗位，检查一下文件内容对不对");
    }

    return { positions, truncated };
  });
}

const rankSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      fitScore: z.number(),
      reason: z.string(),
    })
  ),
});

export type PositionFit = { index: number; fitScore: number; reason: string };

/**
 * Scores every parsed row against the resume in ONE call, rather than reusing
 * the existing per-position matchResumesToPosition (which reads the resume
 * PDF once per position — fine for one position, but 60 imported rows would
 * mean 60 file-reading calls). The resume here is the cached 体检 summary
 * text, so this also works on providers that can't read files at all.
 */
export async function rankImportedPositions(
  rows: ImportedPosition[],
  resumeVersionId: string
): Promise<ActionResult<PositionFit[]>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (rows.length === 0) throw new UserFacingError("没有可匹配的岗位");

    const config = await getUserAiConfig(user.id);
    if (!config) throw new UserFacingError("先去账号设置配置一个 AI Key");

    const { resumeText } = await getResumeContext(resumeVersionId, user.id);

    const listing = rows
      .map((r, i) =>
        `[${i}] ${r.companyName ?? "?"} · ${r.title ?? "?"}${
          [r.track, r.department, r.location, r.note].filter(Boolean).length
            ? "（" + [r.track, r.department, r.location, r.note].filter(Boolean).join("，") + "）"
            : ""
        }`
      )
      .join("\n");

    const prompt = `你在帮一个中国应届生从一批秋招岗位里挑出适合他的。

他的简历情况：
${resumeText}

候选岗位列表：
${listing}

请给每个岗位打一个匹配分并说明理由：
- index：岗位前面方括号里的编号，必须原样对应，每个岗位都要给一条
- fitScore：0-100 的匹配度。看方向是否对口、简历里的经历能不能支撑这个岗位
- reason：一句话说清楚为什么高/低，要具体引用简历里的经历或岗位特点，不要写"比较匹配"这种空话
- 只依据上面给的信息判断；岗位信息很少（比如只有公司名和岗位名）就在 reason 里说明"信息太少，仅按岗位名判断"
- 全部用中文`;

    const raw = await callTextAi({
      config,
      prompt,
      thinkingBudget: 1024,
      timeoutMs: 120000,
      schema: {
        type: "OBJECT",
        properties: {
          results: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                index: { type: "NUMBER" },
                fitScore: { type: "NUMBER" },
                reason: { type: "STRING" },
              },
              required: ["index", "fitScore", "reason"],
            },
          },
        },
        required: ["results"],
      },
    });

    const parsed = rankSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

    // Drop hallucinated indexes so a bad row can't mis-label a real position.
    return parsed.data.results.filter((r) => r.index >= 0 && r.index < rows.length);
  });
}

/** Writes the rows the user kept in the preview. */
export async function importPositions(
  rows: ImportedPosition[]
): Promise<ActionResult<{ created: number; skipped: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (rows.length === 0) throw new UserFacingError("没有选中任何岗位");

    let created = 0;
    let skipped = 0;

    for (const row of rows) {
      const companyName = row.companyName?.trim();
      const title = row.title?.trim();
      if (!companyName || !title) {
        skipped++;
        continue;
      }

      // Same company can appear on many rows; upsert keeps one Company row.
      const company = await db.company.upsert({
        where: { name: companyName },
        update: {},
        create: { name: companyName, addedByUserId: user.id },
      });

      // Don't create a second copy of a position the pool already has.
      const existing = await db.position.findFirst({
        where: { userId: user.id, companyId: company.id, title },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const deadline = row.deadline ? new Date(row.deadline) : null;
      const notes = [row.note, row.source ? `渠道：${row.source}` : null]
        .filter(Boolean)
        .join("；");

      await db.position.create({
        data: {
          userId: user.id,
          companyId: company.id,
          title,
          track: row.track ?? undefined,
          department: row.department ?? undefined,
          location: row.location ?? undefined,
          salaryMin: row.salaryMin ?? undefined,
          salaryMax: row.salaryMax ?? undefined,
          // An unparseable date must not silently become Invalid Date.
          deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined,
          source: row.source ?? undefined,
          jdUrl: row.jdUrl ?? undefined,
          jdText: notes || undefined,
          status: "EVALUATING",
          // Imported rows are unscored — the pool's own AI scoring is a
          // separate, per-position action the user runs deliberately.
          interestScore: computeInterestScore(undefined),
        },
      });
      created++;
    }

    revalidatePath("/pool");
    revalidatePath("/dashboard");
    return { created, skipped };
  });
}
