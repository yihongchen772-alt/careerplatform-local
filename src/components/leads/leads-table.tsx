"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { promoteLeads, deleteLeads, rankStoredLeads } from "@/lib/actions/import-positions";
import { daysUntil } from "@/lib/reminders";

export type Lead = {
  id: string;
  companyName: string;
  title: string;
  track: string | null;
  department: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  deadline: string | null;
  source: string | null;
  jdUrl: string | null;
  note: string | null;
  fitScore: number | null;
  fitReason: string | null;
  batch: string | null;
  promoted: boolean;
};

const ALL = "__all__";
type SortKey = "fit" | "deadline" | "added";

export function LeadsTable({
  leads,
  resumeVersions,
  defaultResumeVersionId,
}: {
  leads: Lead[];
  resumeVersions: { id: string; name: string }[];
  defaultResumeVersionId: string | null;
}) {
  const [q, setQ] = useState("");
  const [city, setCity] = useState(ALL);
  const [track, setTrack] = useState(ALL);
  const [hidePromoted, setHidePromoted] = useState(true);
  const [sort, setSort] = useState<SortKey>("fit");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const resumeId = defaultResumeVersionId ?? resumeVersions[0]?.id ?? null;

  const cities = useMemo(
    () => [...new Set(leads.map((l) => l.location).filter(Boolean))].sort() as string[],
    [leads]
  );
  const tracks = useMemo(
    () => [...new Set(leads.map((l) => l.track).filter(Boolean))].sort() as string[],
    [leads]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = leads.filter((l) => {
      if (hidePromoted && l.promoted) return false;
      if (city !== ALL && l.location !== city) return false;
      if (track !== ALL && l.track !== track) return false;
      if (!needle) return true;
      return [l.companyName, l.title, l.department, l.location, l.note]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(needle));
    });

    return [...filtered].sort((a, b) => {
      if (sort === "fit") return (b.fitScore ?? -1) - (a.fitScore ?? -1);
      if (sort === "deadline") {
        // Undated leads sort last rather than jumping to the front as 0.
        const av = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const bv = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        return av - bv;
      }
      return 0;
    });
  }, [leads, q, city, track, hidePromoted, sort]);

  const selectedVisible = visible.filter((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(
    fn: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>,
    onOk: (data: never) => string
  ) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(onOk(res.data as never));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜公司 / 岗位 / 部门 / 备注"
          className="w-full sm:w-64"
        />
        <FilterSelect value={city} onChange={setCity} options={cities} allLabel="全部城市" />
        <FilterSelect value={track} onChange={setTrack} options={tracks} allLabel="全部方向" />
        <Select value={sort} onValueChange={(v) => v && setSort(v as SortKey)}>
          <SelectTrigger className="w-36">
            <SelectValue>
              {() =>
                sort === "fit" ? "按匹配分" : sort === "deadline" ? "按截止日期" : "按加入顺序"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fit">按匹配分</SelectItem>
            <SelectItem value="deadline">按截止日期</SelectItem>
            <SelectItem value="added">按加入顺序</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={hidePromoted}
            onCheckedChange={(c) => setHidePromoted(c === true)}
          />
          隐藏已加入候选池的
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          共 {visible.length} 条{selected.size > 0 && `，已选 ${selectedVisible.length} 条`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setSelected(
              selectedVisible.length === visible.length
                ? new Set()
                : new Set(visible.map((l) => l.id))
            )
          }
        >
          {selectedVisible.length === visible.length && visible.length > 0 ? "全不选" : "全选"}
        </Button>
        {selectedVisible.length > 0 && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () => promoteLeads(selectedVisible.map((l) => l.id)),
                  (d: { created: number; skipped: number }) =>
                    d.skipped > 0
                      ? `已加入候选池 ${d.created} 个（跳过 ${d.skipped} 个已存在的）`
                      : `已加入候选池 ${d.created} 个`
                )
              }
            >
              <ArrowUpRight />
              加入候选池
            </Button>
            {resumeId && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(
                    () => rankStoredLeads(selectedVisible.map((l) => l.id), resumeId),
                    (d: { scored: number }) => `已按简历给 ${d.scored} 个岗位打分`
                  )
                }
              >
                {busy ? "匹配中..." : "按我的简历匹配"}
              </Button>
            )}
            <ConfirmDeleteButton
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  删除
                </Button>
              }
              title={`从信息库删除 ${selectedVisible.length} 个岗位？`}
              onConfirm={() =>
                run(
                  () => deleteLeads(selectedVisible.map((l) => l.id)),
                  (d: { deleted: number }) => `已删除 ${d.deleted} 个`
                )
              }
            />
          </>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {leads.length === 0
            ? "信息库还是空的——点右上角「导入信息表」传一份 Excel/CSV 进来。"
            : "当前筛选条件下没有岗位。"}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((l) => {
            const left = l.deadline ? daysUntil(new Date(l.deadline)) : null;
            return (
              <label
                key={l.id}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm hover:bg-muted/50"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(l.id)}
                  onCheckedChange={() => toggle(l.id)}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {l.companyName} · {l.title}
                    </span>
                    {l.fitScore != null && (
                      <Badge
                        variant={
                          l.fitScore >= 75 ? "default" : l.fitScore >= 50 ? "secondary" : "outline"
                        }
                      >
                        匹配 {l.fitScore}
                      </Badge>
                    )}
                    {l.promoted && <Badge variant="secondary">已加入候选池</Badge>}
                    {left != null && left >= 0 && left <= 7 && (
                      <Badge variant="destructive">
                        {left === 0 ? "今天截止" : `还有 ${left} 天截止`}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      l.track,
                      l.department,
                      l.location,
                      l.salaryMin || l.salaryMax
                        ? `${l.salaryMin ?? "?"}-${l.salaryMax ?? "?"}K`
                        : null,
                      l.deadline ? `截止 ${l.deadline.slice(0, 10)}` : null,
                      l.source,
                      l.note,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "（无其他信息）"}
                  </p>
                  {l.fitReason && (
                    <p className="text-xs text-muted-foreground">{l.fitReason}</p>
                  )}
                  {l.jdUrl && (
                    <a
                      href={l.jdUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4"
                    >
                      投递链接 <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) {
  if (options.length === 0) return null;
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="w-36">
        <SelectValue>{() => (value === ALL ? allLabel : value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
