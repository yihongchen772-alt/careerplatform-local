import { NextResponse } from "next/server";
import { recordSubmittedApplication } from "@/lib/actions/submitted-application";
export async function POST(request: Request) {
  try { return NextResponse.json(await recordSubmittedApplication(await request.json())); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "记录失败" }, { status: 400 }); }
}
