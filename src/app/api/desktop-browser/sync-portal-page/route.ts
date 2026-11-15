import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { syncOpenPortalPage } from "@/lib/actions/application-sync";

const schema = z.object({
  companyId: z.string().min(1),
  url: z.string().url(),
  pageText: z.string().min(1).max(300000),
  label: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  await requireUser();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数不对" }, { status: 400 });
  }
  const res = await syncOpenPortalPage(parsed.data);
  if (!res.ok) {
    return NextResponse.json({ error: res.message }, { status: 400 });
  }
  return NextResponse.json(res.data);
}
