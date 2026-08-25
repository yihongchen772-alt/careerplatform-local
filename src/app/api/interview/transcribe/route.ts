import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { UserFacingError } from "@/lib/action-result";
import { getUserAiKey } from "@/lib/ai-providers";
import { generateStructuredWithFile } from "@/lib/ai-file-search";

/**
 * A spoken answer arrives as a WAV built in the browser (see
 * src/lib/audio-recorder.ts). It goes through a route handler rather than a
 * Server Action for the same reason the spreadsheet import does: an Action
 * would carry it as a base64 argument, paying a ~33% size tax and running
 * into React's payload guards. Multipart has neither problem.
 */
const MAX_SIZE = 12 * 1024 * 1024;

const resultSchema = z.object({
  transcript: z.string(),
  delivery: z.string().nullish(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();

  try {
    const formData = await request.formData();
    const file = formData.get("audio");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "没收到录音" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "这段录音太长了，一次说 2 分钟以内比较合适" },
        { status: 400 }
      );
    }

    // Gemini specifically, not the user's default provider: of the six
    // providers here it's the only one whose API takes raw audio in the same
    // generateContent call (verified against a real key — a Chinese speech
    // sample came back transcribed correctly in ~3s). Anthropic's Messages
    // API accepts no audio at all, and the OpenAI-compatible
    // /chat/completions path these others share is text-only.
    const config = await getUserAiKey(user.id, "gemini");
    if (!config) {
      return NextResponse.json(
        { error: "语音作答需要配置 Gemini 的 Key（只有它能直接听音频）" },
        { status: 400 }
      );
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const raw = await generateStructuredWithFile({
      config,
      prompt: `这是一名中国应届生在模拟面试里对一道题的口头回答录音。

请做两件事：
1. transcript：逐字转写成中文文本。只写他说的内容，不要加标题、不要总结、不要补全他没说的话。听不清的地方写「（听不清）」。
2. delivery：只针对"怎么说的"给一句话观察——语速偏快还是偏慢、是否流利、有没有明显的口头禅（"呃""就是""然后"）或长时间停顿。只说音频里真实听到的，没什么可说的就填 null。不要评价回答内容本身的好坏，那是后面单独评的。`,
      file: { mimeType: "audio/wav", data: base64 },
      schema: {
        type: "OBJECT",
        properties: {
          transcript: { type: "STRING" },
          delivery: { type: "STRING", nullable: true },
        },
        required: ["transcript"],
      },
      timeoutMs: 90000,
    });

    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "转写结果格式异常，请重试" }, { status: 502 });
    }
    if (!parsed.data.transcript.trim()) {
      return NextResponse.json(
        { error: "这段录音里没听到内容，检查一下麦克风" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      transcript: parsed.data.transcript.trim(),
      delivery: parsed.data.delivery?.trim() || null,
    });
  } catch (err) {
    const message =
      err instanceof UserFacingError ? err.message : "转写失败，请重试";
    if (!(err instanceof UserFacingError)) console.error("[interview/transcribe]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
