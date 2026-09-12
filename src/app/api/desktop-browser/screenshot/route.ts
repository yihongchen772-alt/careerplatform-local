import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saveLocalFile } from "@/lib/local-storage";

const bodySchema = z.object({
  dataUrl: z.string().startsWith("data:image/png;base64,"),
  applicationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});

// 网申浏览器's "截图存档": the visible page (投递成功页, 测评说明, 笔试
// 时间通知) captured by the main process, filed as an attachment on the
// application so the proof lives with the record instead of in a
// screenshots folder nobody finds again. ~2 MB PNGs, hence a route rather
// than a Server Action, same as every other upload here.
export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不对" }, { status: 400 });
  const { dataUrl, applicationId, name } = parsed.data;

  const application = await db.application.findFirst({ where: { id: applicationId, userId: user.id } });
  if (!application) return NextResponse.json({ error: "未找到该投递记录" }, { status: 404 });

  const buffer = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  if (buffer.length > 12 * 1024 * 1024) return NextResponse.json({ error: "截图太大" }, { status: 413 });
  const { url } = await saveLocalFile(buffer, "image/png");
  const attachment = await db.attachment.create({
    data: { userId: user.id, applicationId, url, name: name.endsWith(".png") ? name : `${name}.png` },
  });
  revalidatePath(`/applications/${applicationId}`);
  return NextResponse.json({ id: attachment.id, url });
}
