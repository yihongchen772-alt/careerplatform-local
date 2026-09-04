import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { fetchFileAsInlinePart } from "@/lib/gemini";
import { getFileSearchKey, getImageSearchKey, generateStructuredWithFile } from "@/lib/ai-file-search";

const bodySchema = z.object({
  questions: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
});

// Consumed by electron/browser-view.js's autofill handler. One AI call
// covers every open-ended question detected on the page in a single
// request — see the plan this was built from: generateStructuredWithFile
// has a 90s timeout and no "quick" variant, so answering questions one at a
// time would make a 3-5 question 网申 form take minutes.
export async function POST(request: Request) {
  const user = await requireUser();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }
  const { questions } = parsed.data;

  const resume =
    (await db.resumeVersion.findFirst({ where: { userId: user.id, isDefault: true } })) ??
    (await db.resumeVersion.findFirst({
      where: { userId: user.id, fileUrl: { not: null } },
      orderBy: { createdAt: "desc" },
    }));
  if (!resume?.fileUrl) {
    return NextResponse.json(
      { error: "还没有可用的简历文件，去「简历版本」页上传一份" },
      { status: 400 }
    );
  }

  const file = await fetchFileAsInlinePart(resume.fileUrl);
  const isPdf = file.mimeType === "application/pdf";
  const fileKey = isPdf ? await getFileSearchKey(user.id) : await getImageSearchKey(user.id);
  if (!fileKey) {
    return NextResponse.json(
      {
        error: isPdf
          ? "需要能读 PDF 的 AI Key（Gemini/Claude/OpenAI/Qwen 之一）"
          : "需要先在账号设置配置一个 AI Key",
      },
      { status: 400 }
    );
  }

  const prompt = `你在帮一个应届生填网申表单。下面是他的简历文件，以及网申页面上检测到的几道开放性问题（题目文字是从页面上抓取的，可能不完整或带一些无关字符，尽量按大意理解）。

请基于简历里真实的经历，给每道题写一段可以直接填进网申表单的回答：
- 只用简历里确实有的经历、项目、技能，不要编造简历里没有的内容
- 每题 150-300 字，语气自然、具体，不要写"我是一个xxx的人"这类空话
- 如果某道题跟简历内容完全对不上（比如问"你的家乡在哪"这种简历里没有的信息），就如实写"简历里没有相关信息，需要自己填"，不要瞎编

题目列表：
${questions.map((q) => `- [id:${q.id}] ${q.label}`).join("\n")}`;

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
  if (!result.success) {
    return NextResponse.json({ error: "AI 返回格式异常，请重试" }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
