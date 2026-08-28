"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { getImageSearchKey, generateStructuredWithFile } from "@/lib/ai-file-search";
import { getResumeContext } from "@/lib/resume-context";
import { computeInterestScore } from "@/lib/scoring";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import {
  sheetToText,
  MAX_ROWS,
  MAX_CHARS,
  type ImportedPosition,
} from "@/lib/sheet-import";

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

export type { ImportedPosition };

/**
 * AI fallback for sheets with no recognisable header. The header-mapped path
 * lives in POST /api/import/sheet — a route handler, because sending the file
 * through a Server Action hits both the body-size limit and React's payload
 * guard on real multi-MB sheets.
 */
export async function parseRecruitmentSheet(
  fileBase64: string,
  filename: string
): Promise<ActionResult<{ positions: ImportedPosition[]; truncated: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const buffer = Buffer.from(fileBase64, "base64");
    return extractPositions(user.id, await sheetToText(buffer, filename), "sheet");
  });
}

/**
 * Same extraction, but over text the user pasted in (a 小红书 / 公众号 post,
 * a group-chat dump, an email). This exists because there is no lawful way
 * to pull 小红书 content automatically — no third-party content API, the
 * site is login-walled behind request-signing anti-bot, and web search
 * surfaces none of it (measured: a scoped query returned "没有搜到小红书
 * 内容"). Pasting is the one path that works, so it's made a first-class
 * input rather than leaving the user to retype rows into the form.
 */
export async function parseRecruitmentText(
  text: string
): Promise<ActionResult<{ positions: ImportedPosition[]; truncated: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const trimmed = text.trim();
    if (trimmed.length < 10) throw new UserFacingError("粘贴的内容太短，看不出岗位信息");
    return extractPositions(user.id, trimmed.slice(0, MAX_CHARS), "post");
  });
}


const SCREENSHOT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Screenshots of a 小红书 note / 公众号 post. On a phone, screenshotting is a
 * far more natural gesture than selecting and copying text out of an app that
 * makes selection awkward — and it's the only way to capture posts whose
 * information is baked into an image rather than the caption.
 *
 * Needs an image-capable provider (getImageSearchKey — all six now that
 * DeepSeek/Kimi/Qwen have shipped vision models); errors rather than falling
 * back to the text path, where an incapable provider would "succeed" having
 * read nothing.
 */
export async function parseRecruitmentScreenshot(
  fileBase64: string,
  filename: string
): Promise<ActionResult<{ positions: ImportedPosition[]; truncated: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();

    const ext = filename.toLowerCase().split(".").pop() ?? "";
    const mimeType = SCREENSHOT_MIME[ext];
    if (!mimeType) throw new UserFacingError("只支持 PNG / JPG / WebP 截图");

    if (Buffer.from(fileBase64, "base64").byteLength > 10 * 1024 * 1024) {
      throw new UserFacingError("图片不能超过 10MB");
    }

    const config = await getImageSearchKey(user.id);
    if (!config) {
      throw new UserFacingError("读截图需要能看图的服务商，去账号设置配一个 AI Key（这几家都能读图片）");
    }

    const today = new Date().toISOString().slice(0, 10);
    const raw = await generateStructuredWithFile({
      config,
      file: { mimeType, data: fileBase64 },
      thinkingBudget: 1024,
      timeoutMs: 120000,
      prompt: `这是一张招聘信息的截图（可能来自小红书笔记、公众号推文或群聊）。先读出图里的文字，再从中挑出真正的招聘岗位，整理成结构化列表。界面元素、点赞评论数、话题标签、广告和经验分享都忽略。

今天的日期是 ${today}。

要求：
- 每个岗位一条记录
- companyName：公司名称；title：岗位名称
- track：技术/业务方向，看不出来填 null
- department：所属部门/事业群，没写填 null
- location：工作城市
- salaryMin / salaryMax：月薪，换算成以"K"（千元）为单位的数字；写年薪的换算成月薪；"面议"或没写填 null
- deadline：YYYY-MM-DD。只写"10.15"这种没年份的，以今天 ${today} 为准补成之后最近的那个日期；"长期有效"/"滚动招聘"填 null
- source：投递渠道，没写填 null
- jdUrl：只在图里确实有网址时填，否则 null
- note：其他值得保留的信息，没有填 null
- 图里没有的信息一律填 null，绝对不要编造公司名、日期或链接
- 看不清的地方宁可填 null，不要猜`,
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
    const positions = parsed.data.positions.filter((p) => p.companyName || p.title);
    if (positions.length === 0) {
      throw new UserFacingError(
        "没从这张图里认出岗位——看看是不是截糊了，或者图里本来就没有具体公司和岗位"
      );
    }
    return { positions, truncated: false };
  });
}

async function extractPositions(
  userId: string,
  sourceText: string,
  kind: "sheet" | "post"
): Promise<{ positions: ImportedPosition[]; truncated: boolean }> {
  {
    const config = await getUserAiConfig(userId);
    if (!config) {
      throw new UserFacingError("先去账号设置配置一个 AI Key 才能解析");
    }

    const sheetText = sourceText;
    const truncated = sheetText.length >= MAX_CHARS;

    // The model has no clock, so a bare "10.15" gets a guessed (usually
    // training-era, i.e. past) year — which would make every imported
    // deadline look long overdue to the reminder logic. Give it today.
    const today = new Date().toISOString().slice(0, 10);

    const intro =
      kind === "sheet"
        ? "下面是一份秋招信息表的原始内容（每行是表格的一行，单元格用 | 分隔）。请把它整理成结构化的岗位列表。"
        : "下面是从社交平台/公众号/群聊里复制来的一段秋招信息（可能是小红书笔记、招聘推文或聊天记录，格式很随意，可能夹杂表情、话题标签和无关闲聊）。请从中挑出真正的招聘岗位，整理成结构化列表；广告、经验分享、无具体岗位的内容直接忽略。";

    const prompt = `${intro}

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
      throw new UserFacingError(
        kind === "sheet"
          ? "没从这个表格里认出任何岗位，检查一下文件内容对不对"
          : "没从这段文字里认出任何岗位——可能它只是经验分享、没写具体公司和岗位"
      );
    }

    return { positions, truncated };
  }
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

    return inBatches(rows, RANK_BATCH, RANK_CONCURRENCY, async (batch, offset) => {
    const listing = batch
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

    // Indexes come back relative to this batch; shift them to the caller's
    // numbering. Hallucinated ones are dropped so a bad row can't mis-label
    // a real position.
    return parsed.data.results
      .filter((r) => r.index >= 0 && r.index < batch.length)
      .map((r) => ({ ...r, index: r.index + offset }));
    });
  });
}

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  // An unparseable date must not silently become Invalid Date.
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Writes the kept rows into the 信息库 (JobLead), not the candidate pool —
 * an imported sheet is a wide list of leads to sift through, while the pool
 * is the small set the user has decided to apply to.
 */
export async function importLeads(
  rows: (ImportedPosition & { fitScore?: number | null; fitReason?: string | null })[],
  batch?: string
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

      // Re-importing an updated sheet shouldn't duplicate what's already listed.
      const existing = await db.jobLead.findFirst({
        where: { userId: user.id, companyName, title },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await db.jobLead.create({
        data: {
          userId: user.id,
          companyName,
          title,
          track: row.track ?? undefined,
          department: row.department ?? undefined,
          location: row.location ?? undefined,
          salaryMin: row.salaryMin ?? undefined,
          salaryMax: row.salaryMax ?? undefined,
          deadline: toDateOrNull(row.deadline) ?? undefined,
          source: row.source ?? undefined,
          jdUrl: row.jdUrl ?? undefined,
          note: row.note ?? undefined,
          fitScore: row.fitScore != null ? Math.round(row.fitScore) : undefined,
          fitReason: row.fitReason ?? undefined,
          batch,
        },
      });
      created++;
    }

    revalidatePath("/leads");
    return { created, skipped };
  });
}

/** Moves a lead into the candidate pool — the point at which it becomes something being applied to. */
export async function promoteLeads(
  leadIds: string[]
): Promise<ActionResult<{ created: number; skipped: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (leadIds.length === 0) throw new UserFacingError("没有选中任何岗位");

    const leads = await db.jobLead.findMany({
      where: { id: { in: leadIds }, userId: user.id },
    });

    let created = 0;
    let skipped = 0;

    for (const lead of leads) {
      if (lead.promotedPositionId) {
        skipped++;
        continue;
      }

      const company = await db.company.upsert({
        where: { name: lead.companyName },
        update: {},
        create: { name: lead.companyName, addedByUserId: user.id },
      });

      const existing = await db.position.findFirst({
        where: { userId: user.id, companyId: company.id, title: lead.title },
        select: { id: true },
      });
      if (existing) {
        // Already in the pool by another route — link it so the library
        // stops offering to add it again.
        await db.jobLead.update({
          where: { id: lead.id },
          data: { promotedPositionId: existing.id },
        });
        skipped++;
        continue;
      }

      const notes = [lead.note, lead.source ? `渠道：${lead.source}` : null]
        .filter(Boolean)
        .join("；");

      const position = await db.position.create({
        data: {
          userId: user.id,
          companyId: company.id,
          title: lead.title,
          track: lead.track ?? undefined,
          department: lead.department ?? undefined,
          location: lead.location ?? undefined,
          salaryMin: lead.salaryMin ?? undefined,
          salaryMax: lead.salaryMax ?? undefined,
          deadline: lead.deadline ?? undefined,
          source: lead.source ?? undefined,
          jdUrl: lead.jdUrl ?? undefined,
          jdText: notes || undefined,
          status: "EVALUATING",
          // Unscored on purpose — the pool's own AI scoring is a separate,
          // per-position action the user runs deliberately.
          interestScore: computeInterestScore(undefined),
        },
      });

      await db.jobLead.update({
        where: { id: lead.id },
        data: { promotedPositionId: position.id },
      });
      created++;
    }

    revalidatePath("/leads");
    revalidatePath("/pool");
    revalidatePath("/dashboard");
    return { created, skipped };
  });
}

export async function deleteLeads(leadIds: string[]): Promise<ActionResult<{ deleted: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const res = await db.jobLead.deleteMany({
      where: { id: { in: leadIds }, userId: user.id },
    });
    revalidatePath("/leads");
    return { deleted: res.count };
  });
}

/**
 * Runs `fn` over `items` in small batches, a few batches at a time.
 *
 * One big call is the wrong shape for this work: output tokens are produced
 * serially, so a single request covering everything grows linearly in wall
 * time and eventually trips the request timeout. Measured on a real sheet:
 * scoring 200 rows in one call took 121s, and refining 9 rows whose 岗位
 * cells were each a paragraph blew straight past the 120s limit ("AI 请求
 * 超时"). Small batches keep each request short, and running several at once
 * keeps total time roughly flat as the selection grows.
 */
async function inBatches<TIn, TOut>(
  items: TIn[],
  batchSize: number,
  concurrency: number,
  fn: (batch: TIn[], offset: number) => Promise<TOut[]>
): Promise<TOut[]> {
  const batches: { batch: TIn[]; offset: number }[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push({ batch: items.slice(i, i + batchSize), offset: i });
  }

  const results: TOut[][] = new Array(batches.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= batches.length) return;
      const { batch, offset } = batches[idx];
      results[idx] = await fn(batch, offset);
    }
  });
  await Promise.all(workers);
  return results.flat();
}

/**
 * Upper bound per refine call. The whole point of the header-mapped path is
 * that it handles thousands of rows an AI never could; refining is the
 * opposite trade — smart but context-bound — so it deliberately works on a
 * hand-picked subset rather than the whole sheet.
 */
/**
 * Rows per scoring request, and how many run at once. Measured: a batch costs
 * roughly the same wall time whether it holds 20 rows or 200 — latency is
 * dominated by the model's own turnaround, not by output length — so total
 * time is set by how many waves run, i.e. by concurrency. Batching 200 rows
 * at concurrency 4 was still 124s (3 waves); running all 10 batches at once
 * collapses it to about one wave.
 */
const RANK_BATCH = 20;
const RANK_CONCURRENCY = 10;

const MAX_REFINE_ROWS = 40;
/**
 * Rows per refine request. Very small: one row can expand into a dozen
 * positions, so output length — the slow part — scales with the batch. At 4
 * rows/batch a 9-row selection still took 112s; 2 rows/batch with enough
 * concurrency puts the whole selection in a single wave.
 */
const REFINE_BATCH = 2;
const REFINE_CONCURRENCY = 8;

/**
 * Second pass over rows that came from header mapping. Column mapping copies
 * cells verbatim, which is faithful but dumb: these sheets routinely cram a
 * dozen roles into one 岗位 cell ("算法工程师(运控/VLA/SLAM)、具身AI Infra
 * 研发工程师、…"), leave 方向 unlabelled, and mix 学历要求 into 备注. This
 * asks the model to split those apart and normalise them — the judgement
 * work mapping can't do — without ever needing the full sheet in context.
 */
export async function refineImportedRows(
  rows: ImportedPosition[]
): Promise<ActionResult<{ positions: ImportedPosition[]; inputCount: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (rows.length === 0) throw new UserFacingError("先勾选要精读的岗位");
    if (rows.length > MAX_REFINE_ROWS) {
      throw new UserFacingError(
        `一次最多精读 ${MAX_REFINE_ROWS} 条（现在选了 ${rows.length} 条）——AI 一次读不下太多，分批选吧`
      );
    }

    const config = await getUserAiConfig(user.id);
    if (!config) throw new UserFacingError("先去账号设置配置一个 AI Key");

    const today = new Date().toISOString().slice(0, 10);

    const positions = await inBatches(rows, REFINE_BATCH, REFINE_CONCURRENCY, async (batch) => {
    const listing = batch
      .map(
        (r, i) =>
          `[${i}] 公司：${r.companyName ?? ""}｜岗位：${r.title ?? ""}｜方向：${r.track ?? ""}｜部门：${r.department ?? ""}｜地点：${r.location ?? ""}｜薪资：${r.salaryMin ?? ""}-${r.salaryMax ?? ""}｜截止：${r.deadline ?? ""}｜渠道：${r.source ?? ""}｜备注：${r.note ?? ""}`
      )
      .join("\n");

    const raw = await callTextAi({
      config,
      thinkingBudget: 1024,
      timeoutMs: 120000,
      prompt: `下面是从秋招信息表里按列抓出来的原始记录，字段没整理过。请把它们整理干净。

今天的日期是 ${today}。

原始记录：
${listing}

整理要求：
- 一个格子里塞了多个岗位的，拆成多条。比如"算法工程师(运控/SLAM)、嵌入式工程师、机械工程师"要拆成 3 条，公司、地点、截止日期等信息各自复制一份
- title 只保留岗位名本身，去掉括号里的一长串方向罗列、去掉"招聘""诚聘"这类词
- track：归纳成简短的方向，比如"后端开发""算法""硬件""产品""运营""教师"，看不出来填 null
- location：多个城市保留，但去掉"全国各地"这种无信息量的词
- deadline：整理成 YYYY-MM-DD；"招满为止""长期有效"这类填 null；只有月日的以今天 ${today} 为准补成之后最近的日期
- salaryMin / salaryMax：以 K（千元/月）为单位的数字，原始记录里没有就填 null，不要猜
- note：把学历要求、福利、是否笔试这类有用信息浓缩成一句话，去掉广告词和重复内容；没有就填 null
- 不要编造原始记录里没有的信息，尤其是公司名、薪资、日期和链接
- 拆分后总条数可以多于输入条数`,
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
    return parsed.data.positions.filter((p) => p.companyName && p.title);
    });

    if (positions.length === 0) throw new UserFacingError("AI 没整理出有效结果，请重试");

    // The listing above omits links (they're long and waste context), so put
    // them back by company name.
    const urlByCompany = new Map(
      rows.filter((r) => r.jdUrl).map((r) => [r.companyName ?? "", r.jdUrl as string])
    );
    for (const p of positions) {
      if (!p.jdUrl && p.companyName && urlByCompany.has(p.companyName)) {
        p.jdUrl = urlByCompany.get(p.companyName) ?? null;
      }
    }

    return { positions, inputCount: rows.length };
  });
}


/** Scores leads already stored in the library (the import-time ranking, re-runnable). */
export async function rankStoredLeads(
  leadIds: string[],
  resumeVersionId: string
): Promise<ActionResult<{ scored: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const leads = await db.jobLead.findMany({
      where: { id: { in: leadIds }, userId: user.id },
    });
    if (leads.length === 0) throw new UserFacingError("没有可匹配的岗位");

    const res = await rankImportedPositions(
      leads.map((l) => ({
        companyName: l.companyName,
        title: l.title,
        track: l.track,
        department: l.department,
        location: l.location,
        salaryMin: l.salaryMin,
        salaryMax: l.salaryMax,
        deadline: l.deadline?.toISOString().slice(0, 10) ?? null,
        source: l.source,
        jdUrl: l.jdUrl,
        note: l.note,
      })),
      resumeVersionId
    );
    if (!res.ok) throw new UserFacingError(res.message);

    for (const fit of res.data) {
      const lead = leads[fit.index];
      if (!lead) continue;
      await db.jobLead.update({
        where: { id: lead.id },
        data: { fitScore: Math.round(fit.fitScore), fitReason: fit.reason },
      });
    }

    revalidatePath("/leads");
    return { scored: res.data.length };
  });
}
