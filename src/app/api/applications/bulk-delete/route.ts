import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { isTrustedLocalRequest } from "@/lib/local-request-guard";
import { deleteApplicationsFor } from "@/lib/application-delete";

/**
 * A batch delete still inside its 撤销 window when the window or App closes
 * is sent here with navigator.sendBeacon, so it is not silently dropped.
 */
export async function POST(request: Request) {
  if (!isTrustedLocalRequest(request.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const user = await requireUser();
  const deleted = await deleteApplicationsFor(user.id, input.data.ids);
  revalidatePath("/applications");
  return NextResponse.json({ deleted });
}
