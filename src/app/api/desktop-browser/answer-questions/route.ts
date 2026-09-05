import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { fetchFileAsInlinePart } from "@/lib/gemini";
import { getFileSearchKey, getImageSearchKey, generateStructuredWithFile } from "@/lib/ai-file-search";

const bodySchema = z.object({
  questions: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
  resumeVersionId: z.string().min(1, "没选简历"),
});

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
// covers every open-ended question that isn't already cached, in a single
// request — generateStructuredWithFile has a 90s timeout and no "quick"
// variant, so answering one at a time would make a multi-question 网申 form
// take minutes.
export async function POST(request: Request) {
  const user = await requireUser();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  }
  const { questions, resumeVersionId } = parsed.data;

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
  const needsGeneration: { id: string; label: string }[] = [];
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
        const prompt = `你在帮一个应届生填网申表单。下面是他的简历文件，以及网申页面上检测到的几道开放性问题（题目文字是从页面上抓取的，可能不完整或带一些无关字符，尽量按大意理解）。

请基于简历里真实的经历，给每道题写一段可以直接填进网申表单的回答：
- 只用简历里确实有的经历、项目、技能，不要编造简历里没有的内容
- 每题 150-300 字，语气自然、具体，不要写"我是一个xxx的人"这类空话
- 如果某道题跟简历内容完全对不上（比如问"你的家乡在哪"这种简历里没有的信息），就如实写"简历里没有相关信息，需要自己填"，不要瞎编

题目列表：
${needsGeneration.map((q) => `- [id:${q.id}] ${q.label}`).join("\n")}`;

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
