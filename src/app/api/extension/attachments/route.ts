import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { resolveAutofillAttachments } from "@/lib/attachment-roles";

export async function GET(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const user = await requireUser();
  const rows = await db.attachment.findMany({
    where: { userId: user.id, category: { not: null } },
    select: { id: true, name: true, url: true, category: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const attachments = resolveAutofillAttachments(rows, user.name);
  return NextResponse.json({ attachments });
}
