import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { UserFacingError } from "@/lib/action-result";
import { sheetToRows } from "@/lib/sheet-import";
import { mapApplicationRows } from "@/lib/application-import";

const MAX_SIZE = 10 * 1024 * 1024;

/**
 * Reads the applicant's own tracking sheet (Excel / CSV) into 投递 rows for
 * the import dialog to preview. A multipart POST like the 秋招信息表 upload,
 * for the same reason: a real sheet is too big to pass as an action argument.
 * Nothing is written here; the dialog sends the rows it confirmed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  await requireUser();
  try {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "未收到文件" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
    const rows = await sheetToRows(Buffer.from(await file.arrayBuffer()), file.name);
    const sheet = mapApplicationRows(rows);
    if (!sheet) return NextResponse.json({ error: "没找到「公司」这一列。请确认表格第一行是表头，并且有一列叫「公司」或「公司名称」" }, { status: 400 });
    if (!sheet.rows.length) return NextResponse.json({ error: sheet.skipped ? "这张表里的都是还没投的，没有可导入的投递" : "表头下面没有数据" }, { status: 400 });
    return NextResponse.json(sheet);
  } catch (error) {
    if (!(error instanceof UserFacingError)) console.error("[import/applications]", error);
    return NextResponse.json({ error: error instanceof UserFacingError ? error.message : "解析失败，请检查文件格式" }, { status: 400 });
  }
}
