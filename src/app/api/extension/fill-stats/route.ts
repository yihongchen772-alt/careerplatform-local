import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { recordFillStats } from "@/lib/fill-samples";

const count = z.number().int().min(0).max(1000).optional();
const bodySchema = z.object({ url: z.string().url().max(2000), fills: count, filled: count, manual: count, typed: count });

// 一键填写 counts from the extension, into the same 填写统计.json as the desktop browser.
export async function POST(request: Request) {
  const rejected = await rejectUnpairedExtension(request);
  if (rejected) return rejected;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  const { url, ...patch } = parsed.data;
  await recordFillStats(url, patch);
  return NextResponse.json({ ok: true });
}
