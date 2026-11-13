import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isTrustedLocalRequest } from "@/lib/local-request-guard";
import {
  EXPORT_FORMAT_LABELS,
  applicationsToCsv,
  applicationsToMarkdown,
  applicationsToXlsxBuffer,
  buildApplicationExportRows,
  type ExportFormat,
} from "@/lib/applications-export";

const bodySchema = z.object({
  format: z.enum(["xlsx", "csv", "md"]).default("xlsx"),
  ids: z.array(z.string().min(1)).max(2000).optional(),
  scopeLabel: z.string().trim().max(80).optional(),
});

async function handleExport(format: ExportFormat, ids?: string[], scopeLabel?: string) {
  const user = await requireUser();
  const records = await db.application.findMany({
    where: {
      userId: user.id,
      ...(ids?.length ? { id: { in: ids } } : {}),
    },
    include: {
      company: {
        select: { name: true, industry: true, sector: true },
      },
      position: {
        select: { location: true, jdUrl: true },
      },
      resumeVersion: {
        select: { name: true },
      },
      stageHistory: {
        orderBy: { enteredAt: "desc" },
      },
    },
    orderBy: [{ appliedDate: "desc" }, { createdAt: "desc" }],
  });

  // Preserve requested ordering when ids are explicitly passed, else keep DB order.
  const ordered = ids?.length
    ? [...records].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    : records;
  const rows = buildApplicationExportRows(ordered);
  const meta = EXPORT_FORMAT_LABELS[format];
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `已投递企业与岗位_${stamp}.${meta.ext}`;
  const disposition = `attachment; filename="applications-${stamp}.${meta.ext}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  if (format === "xlsx") {
    const buf = await applicationsToXlsxBuffer(rows);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": meta.mime,
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    });
  }

  const content = format === "md" ? applicationsToMarkdown(rows, scopeLabel) : applicationsToCsv(rows);
  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": meta.mime,
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "导出参数不正确" }, { status: 400 });
  }
  return handleExport(parsed.data.format, parsed.data.ids, parsed.data.scopeLabel);
}

export async function GET(request: Request) {
  if (!isTrustedLocalRequest(request.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const rawFormat = url.searchParams.get("format") || "xlsx";
  const format = (["xlsx", "csv", "md"].includes(rawFormat) ? rawFormat : "xlsx") as ExportFormat;
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean).slice(0, 2000);
  const scopeLabel = url.searchParams.get("scope")?.slice(0, 80) || undefined;
  return handleExport(format, ids?.length ? ids : undefined, scopeLabel);
}
