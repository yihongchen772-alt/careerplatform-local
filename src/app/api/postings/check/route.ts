import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkPostingSources } from "@/lib/campus-sync";

// The desktop app's main process calls this every hour (see
// maybeCheckPostingSheets in electron/main.js) to keep subscribed
// 校招信息表 current, and notifies about what the sheet's owner added.
export async function POST() {
  const user = await requireUser();
  return NextResponse.json(await checkPostingSources(user.id));
}
