import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { loadKnownSites } from "@/lib/known-sites";
import { looksLikeCandidateCenter, matchKnownSite, siteKey } from "@/lib/site-key";

const bodySchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(500).default(""),
  text: z.string().max(20000).default(""),
});

// What the popup shows about the current tab: "已投过 XX" and, on a
// 我的投递 page, whether it can be saved as that company's 进度页.
export async function POST(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  const { url, title, text } = parsed.data;
  const match = matchKnownSite(await loadKnownSites(user.id), url, title);
  const key = siteKey(url);
  return NextResponse.json({
    match,
    candidateCenter: looksLikeCandidateCenter(url, title, text),
    portalSet: !!match && !!key && match.portalKeys.includes(key),
  });
}
