import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { applyUndoLearned } from "@/lib/profile-learning-store";

const bodySchema = z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(80) });

// 撤销 for the 「已记进网申资料」 notice after a hand-filled page.
export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  const result = await applyUndoLearned(user.id, parsed.data.ids);
  revalidatePath("/settings");
  return NextResponse.json(result);
}
