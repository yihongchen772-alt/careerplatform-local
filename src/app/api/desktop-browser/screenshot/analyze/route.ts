import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { generateStructuredWithFile, getImageSearchKey } from "@/lib/ai-file-search";
import { parseScreenshotExtraction, SCREENSHOT_GEMINI_SCHEMA } from "@/lib/screenshot-extract";

const bodySchema = z.object({
  dataUrl: z.string().min(30),
  title: z.string().max(300).optional(),
  url: z.string().max(4000).optional(),
});

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/;

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "截图参数无效" }, { status: 400 });

  const match = DATA_URL_RE.exec(parsed.data.dataUrl);
  if (!match) return NextResponse.json({ error: "不支持的图片格式" }, { status: 400 });
  const [, mimeType, base64] = match;
  if (Buffer.byteLength(base64, "base64") > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "截图太大" }, { status: 413 });
  }

  const config = await getImageSearchKey(user.id);
  if (!config) {
    return NextResponse.json(
      { error: "未配置可看图的 AI Key（Gemini / Claude / OpenAI / DeepSeek / Kimi / Qwen / 智谱 / Mistral）" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `你在帮求职者识别网申浏览器截取的网页截图（可能是投递成功回执、测评/笔试通知、面试邀请或进度页面）。
页面信息：标题「${parsed.data.title || ""}」，网址「${parsed.data.url || ""}」，今天日期是 ${today}。

请从截图画面中准确提取关键信息，严禁编造看不清或画面里没有的内容：
1. kind：exam（笔试/机试/测评邀请或考试窗口）、interview（面试邀请/安排）、confirmation（投递成功回执/报名编号）、offer、rejection、notice（普通通知）、other。
2. companyName / title：截图中体现的公司名与岗位名称，看不出填 null。
3. summary：用 1~2 句简练中文概括核心信息（时间、方式、注意项）。
4. startsAt / endsAt / hasTime：
   - 如果画面里有明确日期+钟点（如「11月20日 19:00-21:00」「2026/11/22 14:30」），hasTime 填 true，startsAt（如有结束时间也填 endsAt）输出带 +08:00 的完整时间如「2026-11-20T19:00:00+08:00」。
   - 如果只有日期/截止日没有具体时刻（如「请在11月25日前完成测评」），hasTime 填 false，输出「YYYY-MM-DD」。
   - 画面里没出现任何日期或考试截止时间时全填 null，hasTime 填 false。
5. entryUrl：画面里展示的笔试/测评/会议完整 https:// 链接，没有填 null。
6. accessCode：考试口令 / 会议号 / 投递编号 / 准考证号，没有填 null。
7. suggestedStage：如果是明确的进度/安排通知，对应到 APPLIED / SCREENING / ASSESSMENT / OA / AI_INTERVIEW / INTERVIEW_1 / INTERVIEW_2 / INTERVIEW_3 / HR_INTERVIEW / OFFER / REJECTED 之一，不确定填 null。`;

  try {
    const raw = await generateStructuredWithFile({
      config,
      prompt,
      file: { mimeType, data: base64 },
      schema: SCREENSHOT_GEMINI_SCHEMA,
      thinkingBudget: 512,
      timeoutMs: 45000,
    });
    const extraction = parseScreenshotExtraction(raw);
    if (!extraction) return NextResponse.json({ error: "识别结果解析失败" }, { status: 502 });
    return NextResponse.json({ extraction });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "截图识别失败" },
      { status: 502 }
    );
  }
}
