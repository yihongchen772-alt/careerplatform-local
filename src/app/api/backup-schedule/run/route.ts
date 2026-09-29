import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { runAutoBackup } from "@/lib/auto-backup";

// Hit by electron/main.js every 30 minutes while the app runs; the backup
// itself decides whether one is due (settings → 数据备份 → 自动备份).
export async function POST() {
  await requireUser();
  return NextResponse.json(await runAutoBackup());
}
