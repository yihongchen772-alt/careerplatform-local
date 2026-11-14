import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  EXPORT_FORMAT_LABELS,
  applicationsToCsv,
  applicationsToMarkdown,
  applicationsToXlsxBuffer,
  buildApplicationExportRows,
  formatExportDate,
  type ExportFormat,
} from "@/lib/applications-export";

export async function buildApplicationsExportResponse({
  userId,
  format,
  ids,
  scopeLabel,
}: {
  userId: string;
  format: ExportFormat;
  ids?: string[];
  scopeLabel?: string;
}) {
  const records = await db.application.findMany({
    where: {
      userId,
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
  const stamp = formatExportDate();
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
