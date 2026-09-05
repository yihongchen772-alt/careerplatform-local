import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { fetchFileAsInlinePart } from "@/lib/gemini";
import { getFileSearchKey, getImageSearchKey, generateStructuredWithFile } from "@/lib/ai-file-search";

// Mirrors the shape /api/desktop-browser/profile returns — passed through
// so the AI has known facts (e.g. the saved name) available alongside the
// resume file, useful for things like deriving a pinyin-name field that
// isn't itself a stored profile value.
const profileSchema = z
  .object({
    name: z.string().nullish(),
    phone: z.string().nullish(),
    email: z.string().nullish(),
    gender: z.string().nullish(),
    birthDate: z.string().nullish(),
    school: z.string().nullish(),
    targetTrack: z.string().nullish(),
    graduationYear: z.number().nullish(),
    preferredCities: z.string().nullish(),
  })
  .partial();

const bodySchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        kind: z.enum(["essay", "short", "choice"]).default("essay"),
        options: z.array(z.string()).optional(),
      })
    )
    .min(1),
  resumeVersionId: z.string().min(1, "没选简历"),
  profile: profileSchema.optional(),
});

// The AI's honest "not derivable from the resume" answer for a short/choice
// field — kept in sync with electron/browser-view.js's NEEDS_MANUAL_INPUT,
// which is what actually decides whether to skip writing this into the
// page (never cached either, below — a "couldn't find it" isn't a real
// answer worth reusing).
const NEEDS_MANUAL_INPUT = "NEEDS_MANUAL_INPUT";

// Dice coefficient over character bigrams — a standard, tokenizer-free way
// to compare short CJK strings. Two phrasings of "为什么选择我们" score high;
// genuinely different questions score low. No fuzzy-matching dependency
// needed for something this small.
function bigrams(s: string): Set<string> {
  const normalized = s.replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) set.add(normalized.slice(i, i + 2));
  return set;
}
function similarity(a: string, b: string): number {
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const gram of setA) if (setB.has(gram)) overlap++;
  return (2 * overlap) / (setA.size + setB.size);
}
const SIMILARITY_THRESHOLD = 0.6;

// Consumed by electron/browser-view.js's autofill handler. One AI call
// covers every field that isn't already cached or matched from the saved
// profile — both the long open-ended questions and the short structured
// ones (性别/出生日期/籍贯/拼音-type fields the app doesn't store as a
// dedicated profile field) — in a single request: generateStructuredWithFile
// has a 90s timeout and no "quick" variant, so answering one at a time would
// make a multi-field 网申 form take minutes.
export async function POST(request: Request) {
  const user = await requireUser();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  }
  const { questions, resumeVersionId, profile } = parsed.data;

  const resume = await db.resumeVersion.findFirst({
    where: { id: resumeVersionId, userId: user.id },
  });
  if (!resume?.fileUrl) {
    return NextResponse.json(
      { error: "选的这份简历没有文件，去「简历版本」页上传一份" },
      { status: 400 }
    );
  }

  // Cache lookup first — reused answers cost nothing and need no AI key.
  const cached = await db.autofillAnswer.findMany({ where: { userId: user.id, resumeVersionId } });
  const answers: { id: string; answer: string; reused: boolean }[] = [];
  const needsGeneration: typeof questions = [];
  for (const q of questions) {
    let best: { answer: string; score: number } | null = null;
    for (const c of cached) {
      const score = similarity(q.label, c.questionLabel);
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { answer: c.answer, score };
      }
    }
    if (best) {
      answers.push({ id: q.id, answer: best.answer, reused: true });
    } else {
      needsGeneration.push(q);
    }
  }

  if (needsGeneration.length > 0) {
    const isPdf = resume.fileUrl.toLowerCase().endsWith(".pdf");
    // Cheap check first — no reason to read the (possibly large) resume
    // file off disk when there's no key configured to do anything with it.
    const fileKey = isPdf ? await getFileSearchKey(user.id) : await getImageSearchKey(user.id);
    if (!fileKey) {
      // Still return whatever was served from cache — a missing key
      // shouldn't throw away answers that needed no AI call at all.
      if (answers.length === 0) {
        return NextResponse.json(
          {
            error: isPdf
              ? "需要能读 PDF 的 AI Key（Gemini/Claude/OpenAI/Qwen 之一）"
              : "需要先在账号设置配置一个 AI Key",
          },
          { status: 400 }
        );
      }
    } else {
      try {
        const file = await fetchFileAsInlinePart(resume.fileUrl);

        const essays = needsGeneration.filter((q) => q.kind === "essay");
        const shortFields = needsGeneration.filter((q) => q.kind !== "essay");
        const knownFacts = profile
          ? Object.entries(profile)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => `${k}: ${v}`)
              .join("；")
          : "";

        const sections: string[] = [];
        if (knownFacts) sections.push(`已知信息（来自他的账号资料，可直接用，不用去简历里找）：\n${knownFacts}`);
        if (essays.length > 0) {
          sections.push(
            `开放性问答题——基于简历里真实的经历，给每道题写一段可以直接填进网申表单的回答：\n` +
              `- 只用简历里确实有的经历、项目、技能，不要编造简历里没有的内容\n` +
              `- 每题 150-300 字，语气自然、具体，不要写"我是一个xxx的人"这类空话\n` +
              `- 如果某道题跟简历内容完全对不上（比如问"你的家乡在哪"这种简历里没有的信息），就如实写"简历里没有相关信息，需要自己填"，不要瞎编\n\n` +
              essays.map((q) => `- [id:${q.id}] ${q.label}`).join("\n")
          );
        }
        if (shortFields.length > 0) {
          sections.push(
            `结构化短字段——从简历（或上面的已知信息）里查出确切的值，每个只给这一个值本身，不要加任何解释或标点：\n` +
              `- 是"从选项里选"的题，只能原样输出给出的选项文字中的一个，一个都不匹配就输出 ${NEEDS_MANUAL_INPUT}\n` +
              `- 简历/已知信息里确实没有依据的，输出 ${NEEDS_MANUAL_INPUT}，绝对不要编造（这类信息一旦错了比空着更糟，比如性别、出生日期）\n\n` +
              shortFields
                .map(
                  (q) =>
                    `- [id:${q.id}] ${q.label}` + (q.options?.length ? `（可选项：${q.options.join("/")}）` : "")
                )
                .join("\n")
          );
        }

        const prompt = `你在帮一个应届生填网申表单。下面是他的简历文件，以及网申页面上检测到的、需要你帮忙填的字段（文字是从页面上抓取的，可能不完整或带一些无关字符，尽量按大意理解）。\n\n${sections.join("\n\n")}`;

        const raw = await generateStructuredWithFile({
          config: fileKey,
          prompt,
          file,
          thinkingBudget: 1024,
          timeoutMs: 90000,
          schema: {
            type: "OBJECT",
            properties: {
              answers: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    id: { type: "STRING" },
                    answer: { type: "STRING" },
                  },
                  required: ["id", "answer"],
                },
              },
            },
            required: ["answers"],
          },
        });

        const resultSchema = z.object({
          answers: z.array(z.object({ id: z.string(), answer: z.string() })),
        });
        const result = resultSchema.safeParse(raw);
        if (result.success) {
          const labelById = new Map(needsGeneration.map((q) => [q.id, q.label]));
          for (const a of result.data.answers) {
            answers.push({ id: a.id, answer: a.answer, reused: false });
            // A "couldn't find it" isn't a real answer — caching it would
            // make a different site's rephrasing of the same question reuse
            // a non-answer instead of getting its own fresh attempt.
            if (a.answer.trim().toUpperCase() === NEEDS_MANUAL_INPUT) continue;
            const label = labelById.get(a.id);
            if (label) {
              await db.autofillAnswer.create({
                data: { userId: user.id, resumeVersionId, questionLabel: label, answer: a.answer },
              });
            }
          }
        } else if (answers.length === 0) {
          return NextResponse.json({ error: "AI 返回格式异常，请重试" }, { status: 502 });
        }
      } catch (err) {
        // A file/AI failure shouldn't discard cache hits already collected —
        // only bail out with an error if there's nothing to return at all.
        if (answers.length === 0) {
          return NextResponse.json(
            { error: err instanceof Error ? err.message : "生成问答失败，请重试" },
            { status: 502 }
          );
        }
      }
    }
  }

  return NextResponse.json({ answers });
}
