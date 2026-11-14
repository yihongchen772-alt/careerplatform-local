import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { isTrustedLocalRequest } from "@/lib/local-request-guard";
import { type ExportFormat } from "@/lib/applications-export";
import { buildApplicationsExportResponse } from "@/lib/applications-export-http";

const bodySchema = z.object({
  format: z.enum(["xlsx", "csv", "md"]).default("xlsx"),
  ids: z.array(z.string().min(1)).optional(),
  scopeLabel: z.string().trim().max(80).optional(),
});

export async function POST(request: Request) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "导出参数不正确" }, { status: 400 });
  }
  return buildApplicationsExportResponse({
    userId: user.id,
    format: parsed.data.format,
    ids: parsed.data.ids,
    scopeLabel: parsed.data.scopeLabel,
  });
}

export async function GET(request: Request) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await requireUser();
  const url = new URL(request.url);
  const rawFormat = url.searchParams.get("format") || "xlsx";
  const format = (["xlsx", "csv", "md"].includes(rawFormat) ? rawFormat : "xlsx") as ExportFormat;
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
  const scopeLabel = url.searchParams.get("scope")?.slice(0, 80) || undefined;
  return buildApplicationsExportResponse({
    userId: user.id,
    format,
    ids: ids?.length ? ids : undefined,
    scopeLabel,
  });
}
