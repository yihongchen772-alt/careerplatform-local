import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { saveAutoSample } from "@/lib/fill-samples";

// Labels and structure only: the extension strips values before sending.
// Page scans carry nulls for what a box does not have (no placeholder, no maxLength).
const text = (max: number) => z.string().max(max).nullish();
const fieldSchema = z.object({
  tag: text(40), type: text(40), label: text(500), placeholder: text(500), name: text(200), section: text(500),
  options: z.array(z.string().max(300)).max(400).nullish(), required: z.boolean().nullish(), maxLength: z.number().nullish(),
  hadValue: z.boolean().nullish(), savedEntries: z.number().nullish(), blockKey: text(10),
});
const bodySchema = z.object({
  page: z.string().url().max(2000),
  title: z.string().max(300).default(""),
  note: z.string().max(1000).default(""),
  frames: z.array(z.object({ url: z.string().max(2000), fields: z.array(fieldSchema).max(600), html: z.string().max(400_000).optional() })).max(20),
});

export async function POST(request: Request) {
  const rejected = await rejectUnpairedExtension(request);
  if (rejected) return rejected;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `样本格式不对：${parsed.error.issues[0]?.path.join(".")}` }, { status: 400 });
  const saved = await saveAutoSample(parsed.data.page, parsed.data, process.env.npm_package_version || "");
  return NextResponse.json({ saved });
}
