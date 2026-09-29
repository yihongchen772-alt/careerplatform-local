import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { createApplication } from "@/lib/actions/applications";
import { sourceFromUrl } from "@/lib/source-from-url";

const bodySchema = z.object({
  companyName: z.string().trim().min(1, "公司必填").max(120),
  title: z.string().trim().min(1, "岗位必填").max(200),
  applyUrl: z.string().max(2000).regex(/^https?:\/\//i),
  resumeVersionId: z.string().max(40).nullish(),
});

// 记为已投递 from the extension: a new application carrying the page it was
// submitted on, so both the extension and the desktop browser can later say
// "已投过".
export async function POST(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  const { companyName, title, applyUrl, resumeVersionId } = parsed.data;
  try {
    await createApplication({ companyName, title, applyUrl, resumeVersionId: resumeVersionId || undefined, appliedDate: new Date(), source: sourceFromUrl(applyUrl) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "记录失败" }, { status: 400 });
  }
}
