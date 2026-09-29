import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { parseJd } from "@/lib/actions/jd-parse";
import { createPosition } from "@/lib/actions/positions";
import { findDuplicatePositions } from "@/lib/actions/job-capture";
import { sourceFromUrl } from "@/lib/source-from-url";

const bodySchema = z.object({ url: z.string().max(2000).regex(/^https?:\/\//i), title: z.string().max(500).default(""), text: z.string().min(20, "页面上读不到岗位内容").max(60000) });

// 收藏岗位 from the extension: AI-parse the JD page and add it to 候选岗位池,
// skipping a position that is already there.
export async function POST(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  const { url, title, text } = parsed.data;
  const jd = await parseJd({ text: text.slice(0, 12000), capture: true });
  if (!jd.ok) return NextResponse.json({ error: `AI 没能解析这页：${jd.message}` }, { status: 400 });
  const data = jd.data;
  const companyName = data.companyName?.trim();
  const positionTitle = data.title?.trim() || title.trim();
  if (!companyName || !positionTitle) return NextResponse.json({ error: "没从这页识别出公司或岗位，打开 App 手动添加" }, { status: 400 });
  const duplicates = await findDuplicatePositions({ companyName, title: positionTitle, jdUrl: url });
  if (duplicates.length) return NextResponse.json({ ok: true, duplicate: true, companyName, title: positionTitle });
  // The AI's salary is in K and may be fractional (日薪 converted to 月薪);
  // the pool stores whole K. Anything off-schema is dropped, not guessed.
  const salary = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null);
  const deadline = data.deadline ? new Date(data.deadline) : null;
  const recruitmentType = (["校招", "实习", "社招"] as const).find((type) => type === data.recruitmentType) ?? null;
  try {
    await createPosition({
      companyName,
      title: positionTitle,
      track: data.track || undefined,
      department: data.department || undefined,
      location: data.location || undefined,
      salaryMin: salary(data.salaryMin),
      salaryMax: salary(data.salaryMax),
      jdText: text.slice(0, 20000),
      jdUrl: url,
      source: sourceFromUrl(url),
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      recruitmentType,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? `保存岗位失败：${err.message.slice(0, 200)}` : "保存岗位失败" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, duplicate: false, companyName, title: positionTitle });
}
