"use client";

import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

type Stats = Awaited<ReturnType<NonNullable<Window["desktopBridge"]>["fillStats"]>>;

/**
 * 填写成功率 per site: what 一键填写 filled against what was still typed by
 * hand afterwards. Pages with several hand-typed boxes keep a structure-only
 * sample by themselves, so a weak site can be fixed without asking.
 */
export function FillStatsCard() {
  const [data, setData] = useState<Stats | null>(null);
  useEffect(() => {
    if (!window.desktopBridge?.fillStats) return;
    window.desktopBridge.fillStats().then(setData).catch(() => {});
  }, []);
  if (!data) return null;
  const rows = Object.entries(data.stats)
    .map(([host, row]) => ({ host, ...row, rate: row.filled + row.typed ? Math.round((row.filled / (row.filled + row.typed)) * 100) : null }))
    .sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""))
    .slice(0, 12);
  if (!rows.length) return null;
  return (
    <section className="surface-card space-y-3 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">各网站填写情况</p>
          <p className="mt-0.5 text-xs text-muted-foreground">一键填写后你还手填了多少。手填 3 项以上的页面会自动存一份表单结构样本（不含你填的内容），用来改进填写，不会上传。</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.desktopBridge?.openSamples()}><FolderOpen className="size-4" />样本 {data.samples}</Button>
      </div>
      <div className="divide-y divide-border/60 text-sm">
        {rows.map((row) => (
          <div key={row.host} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate" title={row.host}>{row.host}</span>
            <span className="shrink-0 text-xs text-muted-foreground">填了 {row.fills} 次 · 自动 {row.filled} 项 · 手填 {row.typed} 项</span>
            <span className={`w-12 shrink-0 text-right text-xs font-medium ${row.rate === null ? "text-muted-foreground" : row.rate >= 80 ? "text-emerald-600" : row.rate >= 50 ? "text-amber-600" : "text-rose-600"}`}>{row.rate === null ? "—" : `${row.rate}%`}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
