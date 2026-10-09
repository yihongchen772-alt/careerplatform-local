import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { askAiForIdentity, identifyInputSchema } from "@/lib/application-identity-ai";

// The 网申浏览器's AI fallback: only called for what its own reading of the
// pages (recognize-application.ts) left blank.
export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = identifyInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不正确" }, { status: 400 });
  return NextResponse.json(await askAiForIdentity(user, parsed.data));
}
