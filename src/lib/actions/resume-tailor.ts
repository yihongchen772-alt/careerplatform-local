"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { callTextAi, getUserAiConfig } from "@/lib/ai-providers";
import { generateStructuredWithFile, getFileSearchKey, getImageSearchKey } from "@/lib/ai-file-search";
import { fetchFileAsInlinePart } from "@/lib/gemini";
import { deleteLocalFileByUrl, saveLocalFile } from "@/lib/local-storage";
import { printResumePdf } from "@/lib/render-bridge-client";
import { photoFromPdf } from "@/lib/resume-photo";
import {
  applyTailorChanges,
  buildTailorChanges,
  docFromParsed,
  docOutline,
  docPlainText,
  parseDraft,
  renderResumeHtml,
  resumeDocSchema,
  tailorTargetSchema,
  type ParsedResume,
  type ResumeDoc,
  type TailorAnswer,
  type TailorDraft,
} from "@/lib/resume-doc";

const MIN_JD = 30;

function emptyDraft(target: TailorDraft["target"]): TailorDraft {
  return { v: 2, target, mode: "text", base: null, doc: null, changes: [], summary: "", keywords: [], generatedAt: null };
}

async function pickResume(userId: string, requested?: string | null) {
  const resumes = await db.resumeVersion.findMany({
    where: { userId },
    select: { id: true, name: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  const resume = resumes.find((r) => r.id === requested) ?? resumes[0];
  if (!resume) throw new UserFacingError("先在「简历版本」上传一份简历，定制会在它上面改");
  return resume;
}

async function ownTailoring(userId: string, id: string) {
  const row = await db.resumeTailoring.findFirst({ where: { id: String(id ?? ""), userId } });
  if (!row) throw new UserFacingError("没找到这份定制，可能已经删除了");
  return row;
}

async function writeDraft(id: string, draft: TailorDraft, extra: Prisma.ResumeTailoringUncheckedUpdateInput = {}) {
  await db.resumeTailoring.update({ where: { id }, data: { ...extra, draft: draft as unknown as Prisma.InputJsonValue } });
}

export type StartTailoringInput = {
  resumeVersionId?: string | null;
  positionId?: string | null;
  company?: string;
  title?: string;
  jdText?: string;
  url?: string;
};

/**
 * Opens a 定制 for one JD — a 候选岗位 (reusing the one already made for it
 * with this resume), or a pasted / page-read JD. Nothing is generated yet.
 */
export async function startTailoring(input: StartTailoringInput): Promise<ActionResult<{ id: string; generated: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const resume = await pickResume(user.id, input.resumeVersionId);
    if (input.positionId) {
      const position = await db.position.findFirst({ where: { id: String(input.positionId), userId: user.id }, include: { company: true } });
      if (!position) throw new UserFacingError("没找到这个岗位，请刷新后重试");
      const existing = await db.resumeTailoring.findMany({ where: { userId: user.id, positionId: position.id, resumeVersionId: resume.id }, orderBy: { updatedAt: "desc" } });
      const withDraft = existing.find((row) => parseDraft(row.draft));
      if (withDraft) return { id: withDraft.id, generated: !!parseDraft(withDraft.draft)?.doc };
      const target = tailorTargetSchema.parse({ company: position.company.name, title: position.title, jdText: position.jdText ?? "", url: position.jdUrl ?? "" });
      const draft = emptyDraft(target) as unknown as Prisma.InputJsonValue;
      if (existing[0]) {
        await db.resumeTailoring.update({ where: { id: existing[0].id }, data: { draft } });
        return { id: existing[0].id, generated: false };
      }
      const created = await db.resumeTailoring.create({ data: { userId: user.id, positionId: position.id, resumeVersionId: resume.id, result: {}, draft } });
      revalidatePath("/resumes");
      return { id: created.id, generated: false };
    }
    const target = tailorTargetSchema.parse({ company: input.company, title: input.title, jdText: input.jdText, url: input.url });
    if (target.jdText.length < MIN_JD) throw new UserFacingError("先贴上 JD 正文（岗位职责和任职要求），AI 才知道往哪个方向改");
    // A page already saved as a 候选岗位 keeps its link to it.
    const position = target.url ? await db.position.findFirst({ where: { userId: user.id, jdUrl: target.url }, select: { id: true } }) : null;
    const created = await db.resumeTailoring.create({
      data: { userId: user.id, positionId: position?.id ?? null, resumeVersionId: resume.id, result: {}, draft: emptyDraft(target) as unknown as Prisma.InputJsonValue },
    });
    revalidatePath("/resumes");
    return { id: created.id, generated: false };
  });
}

/** 网申浏览器 ⋮ → 按这个岗位定制简历: the page's text is the JD. */
export async function startTailoringFromPage(page: { url: string; title: string; text: string }): Promise<ActionResult<{ id: string; generated: boolean }>> {
  // Job pages are usually titled 「岗位名 - 公司 - 招聘」; a generic title is left for the AI to work out.
  const first = String(page.title ?? "").split(/\s*[-_|｜—–]\s*/)[0]?.trim().slice(0, 60) ?? "";
  const title = /^(职位详情|岗位详情|职位|岗位|校园招聘|社会招聘|实习生招聘|招聘|首页|加入我们|careers?|jobs?)$/i.test(first) ? "" : first;
  return startTailoring({ jdText: String(page.text ?? "").slice(0, 20000), title, url: String(page.url ?? "") });
}

// ── reading the original resume once, verbatim ───────────────────────────

const PARSE_RULES = `必须逐字照抄原文：不改写、不润色、不纠错、不翻译、不合并、不省略任何一句；标点、空格、全半角、大小写都照原样。

字段说明：
- name：姓名。
- headline：姓名下面那一行求职意向/身份（如“XX工程师 | 2027 届毕业生”），没有就留空字符串。
- contacts：联系方式等基本信息行，按原来的分行，每行一个字符串；同一行里的多项保留原来的分隔符（如“ | ”）。
- hasPhoto：简历上有没有个人照片。
- sections：按原顺序列出每个板块（教育背景、实习经历、项目经历、专业技能、荣誉奖项、校园经历、自我评价……）：
  - heading：板块标题原文。
  - layout："entries" 表示由若干条目组成（每个条目有一行标题，通常右侧是时间，如学校、公司、项目、竞赛）；"list" 表示带项目符号（•、·、-、▪）的列表（如荣誉奖项）；"lines" 表示不带项目符号的若干行文字（如技能分类行、自我评价、学生工作）。
  - columns：这个板块在原文里是左右两栏并排就填 2，否则填 1。
  - entries（只有 layout 为 entries 时填，否则给空数组）：每个条目：
    - title：条目标题行开头的主体（学校/公司/项目名）。
    - subtitle：标题行里主体之后、时间之前的其余文字，原样保留，包括开头的“|”等分隔符。
    - date：标题行右侧的时间，原样。
    - tags：标题行下面单独一行的技术栈/关键词（通常是彩色或斜体，用“/”“·”分隔），没有就留空字符串。
    - lines：标题行下面、不带项目符号的说明行（如“核心课程：……”“GPA……”），每行一个。
    - bullets：带项目符号的要点，每条一个字符串，去掉开头的符号；原文里因为换行而断开的同一条要拼回一条。
  - items（layout 为 list 或 lines 时填，否则给空数组）：每条/每行一个字符串，去掉开头的项目符号。
- 原文里加粗的词句（条目标题行除外）用 **…** 包起来，比如“**准确率提升 15%**”“**编程：**Python、C++”。
- 不要输出页眉页脚、页码。`;

const PARSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    headline: { type: "STRING" },
    contacts: { type: "ARRAY", items: { type: "STRING" } },
    hasPhoto: { type: "BOOLEAN" },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          heading: { type: "STRING" },
          layout: { type: "STRING", enum: ["entries", "list", "lines"] },
          columns: { type: "INTEGER" },
          entries: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                subtitle: { type: "STRING" },
                date: { type: "STRING" },
                tags: { type: "STRING" },
                lines: { type: "ARRAY", items: { type: "STRING" } },
                bullets: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["title", "subtitle", "date", "tags", "lines", "bullets"],
            },
          },
          items: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["heading", "layout", "columns", "entries", "items"],
      },
    },
  },
  required: ["name", "headline", "contacts", "hasPhoto", "sections"],
} as const;

type BaseResult = { doc: ResumeDoc } | { needsText: true; reason: string };

/**
 * The 底稿 for a resume version: read from its file once (any PDF-capable
 * AI the user has), or from text the user pasted when none can read PDFs.
 */
async function loadBase(userId: string, resumeVersionId: string, options: { refresh?: boolean; pastedText?: string }): Promise<BaseResult> {
  const version = await db.resumeVersion.findFirst({ where: { id: resumeVersionId, userId } });
  if (!version) throw new UserFacingError("没找到这份简历");
  if (!options.refresh && !options.pastedText) {
    const cached = resumeDocSchema.safeParse(version.structured);
    if (cached.success && cached.data.sections.length) return { doc: cached.data };
  }
  let doc: ResumeDoc;
  const pasted = options.pastedText?.trim() ?? "";
  if (pasted) {
    if (pasted.length < 80) throw new UserFacingError("粘贴的简历内容太短，请把整份简历的文字都复制进来");
    const raw = await callTextAi({
      config: await getUserAiConfig(userId),
      prompt: `下面是一份中文简历的全文（从 PDF 或 Word 里复制出来的，换行可能有错位）。把它原样整理成结构化数据。${PARSE_RULES}\n\n简历全文：\n${pasted.slice(0, 15000)}`,
      schema: PARSE_SCHEMA as unknown as Record<string, unknown>,
      thinkingBudget: 512,
      timeoutMs: 150000,
    });
    doc = docFromParsed(raw as ParsedResume, null);
  } else {
    if (!version.fileUrl) return { needsText: true, reason: "这份简历没有上传文件。把简历全文粘贴进来也可以。" };
    const file = await fetchFileAsInlinePart(version.fileUrl);
    const isPdf = file.mimeType === "application/pdf";
    const key = isPdf ? await getFileSearchKey(userId) : await getImageSearchKey(userId);
    if (!key) {
      return { needsText: true, reason: `你配置的 AI 读不了${isPdf ? " PDF" : "图片"}（Gemini、Claude、OpenAI、通义千问可以）。也可以把简历全文复制粘贴进来。` };
    }
    const raw = (await generateStructuredWithFile({
      config: key,
      prompt: `附件是一份中文简历。把它原样转成结构化数据，之后要在原版式上做小修改。${PARSE_RULES}`,
      file,
      schema: PARSE_SCHEMA as unknown as Record<string, unknown>,
      thinkingBudget: 512,
      timeoutMs: 150000,
    })) as ParsedResume;
    const photo = isPdf && raw?.hasPhoto !== false ? photoFromPdf(Buffer.from(file.data, "base64")) : null;
    doc = docFromParsed(raw, photo);
  }
  if (!doc.sections.length) throw new UserFacingError("没能从这份简历里读出内容，换一份简历或把全文粘贴进来再试");
  await db.resumeVersion.update({ where: { id: version.id }, data: { structured: doc as unknown as Prisma.InputJsonValue, structuredAt: new Date() } });
  return { doc };
}

// ── the AI's small changes ───────────────────────────────────────────────

const TAILOR_SCHEMA = {
  type: "OBJECT",
  properties: {
    company: { type: "STRING" },
    title: { type: "STRING" },
    summary: { type: "STRING" },
    keywords: { type: "ARRAY", items: { type: "OBJECT", properties: { word: { type: "STRING" }, covered: { type: "BOOLEAN" } }, required: ["word", "covered"] } },
    edits: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, text: { type: "STRING" }, reason: { type: "STRING" } }, required: ["id", "text", "reason"] } },
    order: { type: "ARRAY", items: { type: "OBJECT", properties: { parent: { type: "STRING" }, children: { type: "ARRAY", items: { type: "STRING" } }, reason: { type: "STRING" } }, required: ["parent", "children", "reason"] } },
  },
  required: ["company", "title", "summary", "keywords", "edits", "order"],
} as const;

function tailorPrompt(base: ResumeDoc, target: TailorDraft["target"], mode: TailorDraft["mode"]): string {
  return `你在帮一位中国应届生把简历针对一个岗位做“微调”：版式完全不变，只改少量文字，让 HR 和简历筛选系统一眼看到与 JD 对应的经历和关键词。

目标岗位：
公司：${target.company || "（从 JD 里认）"}
岗位：${target.title || "（从 JD 里认）"}
JD：
${target.jdText.slice(0, 8000)}

简历（行首 [编号] 是这处文字的编号，只能改带 [编号] 的内容；<s1>、<e2> 是板块和条目的编号；姓名、联系方式、条目标题行、时间都不能改）：
${docOutline(base)}

改写规则：
1. 只改与这个 JD 关系最大的 3–10 处，其余一字不动。
2. 只能换说法、调整语序、换成 JD 里的同义关键词、把与 JD 最相关的内容提前或改成加粗（**…**）。
3. 绝不新增原简历没有的经历、技能、工具、数字、奖项或职责；数字必须和原文一模一样。JD 要求而简历里没有的，不要硬加。
4. 每处改后的字数与原文相差不超过 10%，保证排版和页数不变。
5. [headline] 可以把求职意向换成这个岗位的名称或方向，其余部分（如届别）保留。
6. 课程、技能这类列举，可以把与 JD 相关的项挪到前面，不能加新项。
7. edits 里 id 写编号本身（如 p12、e3.tags、headline），text 是改后的完整文字（不要带开头的“•”），reason 用一句话（不超过 30 字）说明对应 JD 的哪条要求。
${mode === "order"
    ? "8. 另外可以调整顺序，把与 JD 最相关的放前面：order 里 parent 写板块编号（如 s2，调整其中条目或行的顺序）或条目编号（如 e3，调整其中要点的顺序），children 写全部子项编号的新顺序（必须是原有编号的重新排列，一个不能少）。教育背景不要调。"
    : "8. 不调整任何顺序，order 给空数组。"}

另外给出：
- summary：一句话说这个岗位最看重什么、这份简历往哪个方向调了。
- keywords：JD 里最重要的 6–12 个关键词（技能、工具、能力，每个不超过 10 个字），covered 表示简历里确实有对应的经历。
- company、title：JD 里的公司名和岗位名（上面已给出的就照抄）。
全部用中文，专有名词除外。`;
}

export type GenerateTailoringInput = {
  resumeVersionId?: string;
  mode?: "text" | "order";
  company?: string;
  title?: string;
  jdText?: string;
  /** Re-read the original resume file instead of reusing the stored 底稿. */
  refreshBase?: boolean;
  /** The whole resume as text, when no configured AI can read the file. */
  pastedResume?: string;
};

export type GenerateTailoringResult =
  | { status: "done"; changes: number; held: number }
  | { status: "needs-resume-text"; reason: string };

/** Reads the 底稿 if needed, then asks for the small changes and applies them. */
export async function generateTailoring(id: string, input: GenerateTailoringInput = {}): Promise<ActionResult<GenerateTailoringResult>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await ownTailoring(user.id, id);
    const previous = parseDraft(row.draft) ?? emptyDraft(tailorTargetSchema.parse({}));
    const resume = await pickResume(user.id, input.resumeVersionId ?? row.resumeVersionId);
    const target = tailorTargetSchema.parse({
      company: input.company ?? previous.target.company,
      title: input.title ?? previous.target.title,
      jdText: input.jdText ?? previous.target.jdText,
      url: previous.target.url,
    });
    if (target.jdText.length < MIN_JD) throw new UserFacingError("先贴上 JD 正文（岗位职责和任职要求），AI 才知道往哪个方向改");
    const mode = input.mode ?? previous.mode;

    const base = await loadBase(user.id, resume.id, { refresh: input.refreshBase, pastedText: input.pastedResume });
    if ("needsText" in base) {
      await writeDraft(row.id, { ...previous, target, mode }, { resumeVersionId: resume.id });
      return { status: "needs-resume-text", reason: base.reason } as const;
    }

    const raw = (await callTextAi({
      config: await getUserAiConfig(user.id),
      prompt: tailorPrompt(base.doc, target, mode),
      schema: TAILOR_SCHEMA as unknown as Record<string, unknown>,
      thinkingBudget: 2048,
      timeoutMs: 150000,
    })) as TailorAnswer | null;
    if (!raw || typeof raw !== "object") throw new UserFacingError("AI 返回格式异常，请重试");
    const changes = buildTailorChanges(base.doc, raw, mode);
    const draft: TailorDraft = {
      v: 2,
      target: {
        ...target,
        company: target.company || String(raw.company ?? "").trim().slice(0, 80),
        title: target.title || String(raw.title ?? "").trim().slice(0, 120),
      },
      mode,
      base: { ...base.doc, photo: null },
      doc: { ...applyTailorChanges(base.doc, changes), autoFit: true },
      changes,
      summary: String(raw.summary ?? "").trim().slice(0, 300),
      keywords: (Array.isArray(raw.keywords) ? raw.keywords : [])
        .map((k) => ({ word: String(k.word ?? "").trim().slice(0, 30), covered: k.covered === true }))
        .filter((k) => k.word)
        .slice(0, 14),
      generatedAt: new Date().toISOString(),
    };
    await writeDraft(row.id, draft, { resumeVersionId: resume.id });
    revalidatePath("/resumes");
    return { status: "done", changes: changes.length, held: changes.filter((c) => c.kind === "text" && c.flag).length } as const;
  });
}

/** Autosave of the working document (typing, 改回/用这条, 隐藏, font size, photo). */
export async function saveTailoringDoc(id: string, doc: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await ownTailoring(user.id, id);
    const draft = parseDraft(row.draft);
    if (!draft?.doc) throw new UserFacingError("这份定制还没有生成");
    const parsed = resumeDocSchema.safeParse(doc);
    if (!parsed.success) throw new UserFacingError("简历内容格式不对，刷新页面后再试");
    await writeDraft(row.id, { ...draft, doc: parsed.data });
    return null;
  });
}

/** Changes the JD / company / title kept with a 定制 (before regenerating, or just to correct the name). */
export async function updateTailoringTarget(id: string, target: { company?: string; title?: string; jdText?: string }): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await ownTailoring(user.id, id);
    const draft = parseDraft(row.draft) ?? emptyDraft(tailorTargetSchema.parse({}));
    const next = tailorTargetSchema.parse({ ...draft.target, ...target });
    await writeDraft(row.id, { ...draft, target: next });
    return null;
  });
}

function versionName(draft: TailorDraft, requested?: string): string {
  const own = String(requested ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (own) return own;
  const target = [draft.target.company, draft.target.title].filter(Boolean).join("·");
  return `定制·${target || "按 JD"}`.slice(0, 60);
}

/**
 * 存为简历版本: prints the document to PDF and keeps it as a 简历版本 —
 * a new one the first time, the same one (file replaced) after that, so
 * 一键填写 and 投递记录 can use it like any uploaded resume.
 */
export async function saveTailoringAsVersion(id: string, name?: string, options: { asNew?: boolean } = {}): Promise<ActionResult<{ resumeVersionId: string; name: string; updated: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await ownTailoring(user.id, id);
    const draft = parseDraft(row.draft);
    if (!draft?.doc) throw new UserFacingError("这份定制还没有生成");
    const label = versionName(draft, name);
    const pdf = await printResumePdf(renderResumeHtml(draft.doc, `${draft.doc.name || "简历"}-${label}`));
    const { url } = await saveLocalFile(pdf, "application/pdf");
    const now = new Date();
    const data = {
      name: label,
      fileUrl: url,
      targetTrack: draft.target.title || null,
      structured: draft.doc as unknown as Prisma.InputJsonValue,
      structuredAt: now,
      extractedText: docPlainText(draft.doc),
      extractedAt: now,
    };
    // 另存为新版本 leaves the earlier one as it is and points this 定制 at the new one.
    const existing = row.savedVersionId && !options.asNew ? await db.resumeVersion.findFirst({ where: { id: row.savedVersionId, userId: user.id } }) : null;
    let versionId: string;
    if (existing) {
      // The file changed, so an old 简历体检 no longer describes it.
      await db.resumeVersion.update({ where: { id: existing.id }, data: { ...data, checkScore: null, checkResult: Prisma.JsonNull, checkedAt: null } });
      if (existing.fileUrl && existing.fileUrl !== url) await deleteLocalFileByUrl(existing.fileUrl);
      versionId = existing.id;
    } else {
      const created = await db.resumeVersion.create({ data: { userId: user.id, ...data } });
      await db.resumeTailoring.update({ where: { id: row.id }, data: { savedVersionId: created.id } });
      versionId = created.id;
    }
    revalidatePath("/resumes");
    revalidatePath("/browser");
    return { resumeVersionId: versionId, name: label, updated: !!existing };
  });
}

/** Deletes the working copy; a 简历版本 already saved from it stays. */
export async function deleteTailoring(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.resumeTailoring.deleteMany({ where: { id: String(id ?? ""), userId: user.id } });
    revalidatePath("/resumes");
    return null;
  });
}
