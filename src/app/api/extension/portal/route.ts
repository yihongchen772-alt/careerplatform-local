import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { setCompanyPortalUrl } from "@/lib/actions/application-sync";

const bodySchema = z.object({ companyId: z.string().min(1).max(40), url: z.string().max(2000) });

// 设为进度页 from the extension — the same action as the desktop browser's.
export async function POST(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  const res = await setCompanyPortalUrl(parsed.data.companyId, parsed.data.url);
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.message }, { status: 400 });
}
