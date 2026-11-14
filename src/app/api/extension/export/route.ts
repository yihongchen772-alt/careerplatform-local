import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { requireUser } from "@/lib/session";
import { type ExportFormat } from "@/lib/applications-export";
import { buildApplicationsExportResponse } from "@/lib/applications-export-http";

export async function GET(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const user = await requireUser();
  const url = new URL(request.url);
  const rawFormat = url.searchParams.get("format") || "xlsx";
  const format = (["xlsx", "csv", "md"].includes(rawFormat) ? rawFormat : "xlsx") as ExportFormat;
  const scopeLabel = url.searchParams.get("scope")?.slice(0, 80) || undefined;
  return buildApplicationsExportResponse({
    userId: user.id,
    format,
    scopeLabel,
  });
}
