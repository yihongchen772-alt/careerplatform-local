import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { UserFacingError } from "@/lib/action-result";
import { mapByHeader, sheetToRows, MAX_MAPPED_ROWS } from "@/lib/sheet-import";

const MAX_SIZE = 10 * 1024 * 1024;

/**
 * Spreadsheet upload goes through a route handler rather than a Server
 * Action. Actions carry the file as a base64 argument, which both blew the
 * 1MB body limit and then tripped React's payload guard ("Maximum array
 * nesting exceeded") on a real 2.5MB sheet — measured, not theoretical. A
 * plain multipart POST has neither problem and skips the ~33% base64 tax.
 *
 * Only the deterministic header-mapped path lives here; sheets without a
 * recognisable header fall back to the AI Server Action, which needs a much
 * smaller flattened-text payload anyway.
 */
export async function POST(request: Request): Promise<NextResponse> {
  await requireUser();

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "未收到文件" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await sheetToRows(buffer, file.name);
    const mapped = mapByHeader(rows);

    if (!mapped) {
      // Caller should retry through the AI path.
      return NextResponse.json({ needsAi: true });
    }

    return NextResponse.json({
      positions: mapped.slice(0, MAX_MAPPED_ROWS),
      truncated: mapped.length > MAX_MAPPED_ROWS,
      total: mapped.length,
    });
  } catch (err) {
    const message =
      err instanceof UserFacingError ? err.message : "解析失败，请检查文件格式";
    if (!(err instanceof UserFacingError)) console.error("[import/sheet]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
