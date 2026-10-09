import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { identifyApplication, withAiAnswer } from "@/lib/application-identity";
import { askAiForIdentity, identifyInputSchema } from "@/lib/application-identity-ai";
import { loadIdentityContext, loadKnownSites } from "@/lib/known-sites";

// The extension's 记为已投递: which company and job the current tab's 网申
// was — the same reading of the page as the 网申浏览器's, with the AI only
// for what it leaves blank.
export async function POST(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const user = await requireUser();
  const parsed = identifyInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  const input = parsed.data;
  const { pool, sites } = await loadIdentityContext(user.id, await loadKnownSites(user.id));
  const found = identifyApplication({ url: input.url, title: input.title, text: input.text, siteName: input.siteName, history: input.history, fields: input.fields }, pool, sites);
  if (found.companyName && found.title) return NextResponse.json({ ...found, usedAi: false });
  const ai = await askAiForIdentity(user, { ...input, known: { companyName: found.companyName, title: found.title } });
  return NextResponse.json(withAiAnswer(found, ai, pool));
}
