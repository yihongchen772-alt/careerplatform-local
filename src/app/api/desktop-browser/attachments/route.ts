import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveAutofillAttachments } from "@/lib/attachment-roles";

export async function GET() {
  const user = await requireUser();
  const rows = await db.attachment.findMany({
    where: { userId: user.id, category: { not: null } },
    select: { id: true, name: true, url: true, category: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const attachments = resolveAutofillAttachments(rows, user.name);
  return NextResponse.json({ attachments });
}
