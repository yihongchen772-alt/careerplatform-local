"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Table } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportFormat } from "@/lib/applications-export";
import { todayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Props = {
  totalCount: number;
  filteredIds?: string[];
  scopeLabel?: string;
  label?: string;
  variant?: "outline" | "default" | "secondary" | "ghost";
  size?: "sm" | "default" | "xs";
  className?: string;
};

const FORMAT_ITEMS: { format: ExportFormat; title: string; hint: string; icon: typeof FileSpreadsheet }[] = [
  { format: "xlsx", title: "Excel 工作簿 (.xlsx)", hint: "含岗位明细 + 企业汇总双表", icon: FileSpreadsheet },
  { format: "csv", title: "CSV 表格 (.csv)", hint: "UTF-8 编码，兼容 Excel / WPS", icon: Table },
  { format: "md", title: "Markdown 清单 (.md)", hint: "适合贴入飞书 / Notion / 笔记", icon: FileText },
];

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      /* fallback below */
    }
  }
  const plainMatch = /filename="([^"]+)"/i.exec(header);
  return plainMatch?.[1]?.trim() || fallback;
}

export function ExportApplicationsMenu({
  totalCount,
  filteredIds,
  scopeLabel,
  label = "导出清单",
  variant = "outline",
  size = "sm",
  className,
}: Props) {
  const [busy, setBusy] = useState(false);

  const hasFilteredSubset =
    Array.isArray(filteredIds) && filteredIds.length > 0 && filteredIds.length < totalCount;

  async function runExport(format: ExportFormat, ids?: string[], scope?: string) {
    if (busy || totalCount === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/applications/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          ...(ids?.length ? { ids } : {}),
          ...(scope ? { scopeLabel: scope } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "导出失败，请稍后重试");
      }
      const blob = await res.blob();
      const fallback = `已投递企业与岗位_${todayKey()}.${format}`;
      const filename = filenameFromDisposition(res.headers.get("content-disposition"), fallback);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const count = ids?.length ?? totalCount;
      toast.success(`已导出 ${count} 条投递记录（.${format}）`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy || totalCount === 0}
        render={
          <Button
            type="button"
            variant={variant}
            size={size}
            className={cn("gap-1.5", className)}
            disabled={busy || totalCount === 0}
            title={totalCount === 0 ? "暂无已投递记录" : "导出已申请的企业和岗位清单（Excel / CSV / Markdown）"}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            <span>{busy ? "导出中…" : label}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        {hasFilteredSubset && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>当前筛选（{filteredIds.length} 条）</DropdownMenuLabel>
              {FORMAT_ITEMS.map(({ format, title, hint, icon: Icon }) => (
                <DropdownMenuItem
                  key={`filtered-${format}`}
                  onClick={() => void runExport(format, filteredIds, scopeLabel || "当前筛选")}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium">{title}</div>
                    <div className="text-[11px] text-muted-foreground">{hint}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>全部已投递（{totalCount} 条）</DropdownMenuLabel>
          {FORMAT_ITEMS.map(({ format, title, hint, icon: Icon }) => (
            <DropdownMenuItem
              key={`all-${format}`}
              onClick={() => void runExport(format)}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium">{title}</div>
                <div className="text-[11px] text-muted-foreground">{hint}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
