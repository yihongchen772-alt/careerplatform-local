import { isTrustedLocalRequest } from "@/lib/local-request-guard";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { importBackup, previewBackup } from "@/lib/actions/backup";
import { MAX_BACKUP_BYTES } from "@/lib/backup-files";

// Backups can exceed the Server Action 16MB limit. Bound the raw streamed
// request independently, before JSON parsing, for preview and restore alike.
export async function POST(request: Request) {
  if (!isTrustedLocalRequest(request.headers)) return new NextResponse("Forbidden", { status: 403 });
  await requireUser();
  const mode = new URL(request.url).searchParams.get("mode");
  if (!["preview", "import"].includes(mode ?? "")) return NextResponse.json({ ok: false, message: "备份操作不支持" }, { status: 400 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BACKUP_BYTES || !request.body) return NextResponse.json({ ok: false, message: "备份为空或超过 256MB" }, { status: 413 });
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BACKUP_BYTES) { await reader.cancel(); return NextResponse.json({ ok: false, message: "备份超过 256MB" }, { status: 413 }); }
      chunks.push(value);
    }
    const json = Buffer.concat(chunks).toString("utf8");
    return NextResponse.json(mode === "preview" ? await previewBackup(json) : await importBackup(json));
  } finally { reader.releaseLock(); }
}
