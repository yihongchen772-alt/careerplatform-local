"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Plus, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { AddToPoolButton } from "@/components/leads/postings-controls";
import { addPostingsToPool } from "@/lib/actions/campus-postings";
import { launchBatchApply } from "@/lib/batch-apply";
import type { PostingMatchResult } from "@/lib/posting-match";

export type PostingTableRow = {
  id: string;
  company: string;
  isNew: boolean;
  metaText: string;
  roles: string | null;
  note: string | null;
  citiesText: string;
  citiesTitle: string | null;
  cohortKind: string;
  startLabel: string;
  startIsToday: boolean;
  deadlineLabel: string;
  deadlineUrgent: boolean;
  deadlinePast: boolean;
  deadlineNote: string | null;
  applyUrl: string | null;
  noticeUrl: string | null;
  addedToPool: boolean;
  match?: PostingMatchResult;
};

export function PostingsTableClient({
  rows,
  showMatch,
}: {
  rows: PostingTableRow[];
  showMatch: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAdding, startBatchAdding] = useTransition();

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleBatchAdd() {
    const ids = [...selected];
    if (!ids.length) return;
    startBatchAdding(async () => {
      const result = await addPostingsToPool(ids);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        result.data.existed
          ? `已新加入 ${result.data.added} 个，另有 ${result.data.existed} 个已在候选池中`
          : `已批量加入 ${result.data.added} 个岗位到候选池`
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  async function handleBatchApply() {
    const chosen = rows.filter((r) => selected.has(r.id) && !!r.applyUrl);
    if (!chosen.length) {
      toast.error("选中的岗位暂时没有附带直接网申链接");
      return;
    }
    const res = await launchBatchApply(
      chosen.map((r) => ({
        url: r.applyUrl!,
        company: r.company,
        title: (r.roles || "").split(/[\n、,，]+/)[0]?.slice(0, 40) || r.cohortKind || "校园招聘",
        sourceLabel: "校招信息表",
      })),
      (href) => router.push(href)
    );
    toast.success(
      res.mode === "desktop"
        ? `已在网申浏览器打开 ${res.count} 个岗位并排队预填，顶部「待确认清单」可统一核对提交`
        : `已生成 ${res.count} 个待投递链接清单`
    );
  }

  return (
    <div className="space-y-2.5">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-2 text-sm">
          <span>
            已勾选 <strong>{selected.size}</strong> 条校招信息
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleBatchApply()}>
              <Rocket className="mr-1.5 size-3.5" />
              批量打开网申并预填
            </Button>
            <Button size="sm" variant="outline" disabled={batchAdding} onClick={handleBatchAdd}>
              <Plus className="mr-1.5 size-3.5" />
              {batchAdding ? "加入中…" : "批量加入候选池"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="w-9 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="全选本页招聘信息"
                />
              </th>
              <th className="px-3 py-2 font-medium">公司</th>
              {showMatch && <th className="px-3 py-2 font-medium">匹配度</th>}
              <th className="px-3 py-2 font-medium">岗位方向</th>
              <th className="px-3 py-2 font-medium">地点</th>
              <th className="px-3 py-2 font-medium">届次 · 类型</th>
              <th className="px-3 py-2 font-medium">发布</th>
              <th className="px-3 py-2 font-medium">截止</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                data-posting-id={row.id}
                className="border-t align-top data-[last-opened=true]:bg-primary/10"
              >
                <td className="px-3 py-2.5">
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={(v) => toggleOne(row.id, v === true)}
                    aria-label={`选择 ${row.company}`}
                  />
                </td>
                <td className="max-w-48 px-3 py-2">
                  <p className="font-medium">
                    {row.company}
                    {row.isNew && (
                      <span className="ml-1.5 rounded bg-red-500/10 px-1 py-px align-middle text-[10px] font-medium text-red-600">
                        新
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.metaText}</p>
                </td>
                {showMatch && (
                  <td className="px-3 py-2">
                    {row.match && row.match.score > 0 ? (
                      <div className="space-y-1">
                        <Badge
                          variant={row.match.tier === "high" ? "default" : "secondary"}
                          className={cn(
                            "text-[11px] tabular-nums",
                            row.match.tier === "high" && "bg-emerald-600 text-white hover:bg-emerald-600"
                          )}
                        >
                          {row.match.score}% 推荐
                        </Badge>
                        {row.match.reasons.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {row.match.reasons.map((reason) => (
                              <span
                                key={reason}
                                className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                <td className="max-w-72 px-3 py-2">
                  <p
                    className="line-clamp-2 text-xs leading-relaxed whitespace-pre-line"
                    title={[row.roles, row.note].filter(Boolean).join("\n\n")}
                  >
                    {row.roles || row.note || "—"}
                  </p>
                </td>
                <td className="max-w-40 px-3 py-2 text-xs" title={row.citiesTitle ?? undefined}>
                  {row.citiesText || "—"}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                  {row.cohortKind || "—"}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {row.startIsToday ? (
                    <span className="font-medium text-primary">今天</span>
                  ) : (
                    row.startLabel
                  )}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {row.deadlineLabel ? (
                    <span
                      className={cn(
                        row.deadlinePast
                          ? "text-muted-foreground line-through"
                          : row.deadlineUrgent
                          ? "font-medium text-red-600"
                          : ""
                      )}
                    >
                      {row.deadlineLabel}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{row.deadlineNote || "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                    {row.applyUrl && (
                      <Link
                        href={`/browser?url=${encodeURIComponent(row.applyUrl)}`}
                        className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                      >
                        投递
                        <ExternalLink className="size-3" />
                      </Link>
                    )}
                    {row.noticeUrl && row.noticeUrl !== row.applyUrl && (
                      <Link
                        href={`/browser?url=${encodeURIComponent(row.noticeUrl)}`}
                        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
                        title="招聘公告"
                      >
                        <FileText className="size-3" />
                        公告
                      </Link>
                    )}
                    <AddToPoolButton postingId={row.id} added={row.addedToPool} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
