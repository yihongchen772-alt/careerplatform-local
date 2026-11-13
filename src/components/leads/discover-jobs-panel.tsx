"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Globe, Loader2, Plus, Rocket, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addDiscoveredJobsToPool } from "@/lib/actions/campus-postings";
import { launchBatchApply } from "@/lib/batch-apply";
import type { BoardJob } from "@/lib/career-ops";

type DiscoverResponse = {
  jobs: BoardJob[];
  total: number;
  channels: { boards: number; sheets: number; web: number };
  searched: { name: string; found: number; error: string | null }[];
};

const QUICK_TOPICS = ["前端", "后端", "嵌入式", "AI算法", "产品经理", "硬件", "数据分析"];

export function DiscoverJobsPanel({
  defaultTrack,
  defaultCities,
}: {
  defaultTrack: string;
  defaultCities: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultTrack || "");
  const [cities, setCities] = useState(defaultCities || "");
  const [includeBoards, setIncludeBoards] = useState(true);
  const [includeSheets, setIncludeSheets] = useState(true);
  const [includeWeb, setIncludeWeb] = useState(true);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [adding, startAdding] = useTransition();

  async function handleSearch(overrideQuery?: string) {
    const q = (overrideQuery ?? query).trim();
    if (!q) {
      toast.error("请输入你想检索的岗位关键词或公司名");
      return;
    }
    if (overrideQuery !== undefined) setQuery(overrideQuery);
    setSearching(true);
    setSelected(new Set());
    try {
      const res = await fetch("/api/leads/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          cities,
          includeBoards,
          includeSheets,
          includeWeb,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "搜索失败");
        return;
      }
      setData(json as DiscoverResponse);
    } catch {
      toast.error("搜索失败，请检查网络或稍后再试");
    } finally {
      setSearching(false);
    }
  }

  function toggleAll(checked: boolean) {
    if (!data?.jobs.length) return;
    setSelected(checked ? new Set(data.jobs.map((j) => j.url)) : new Set());
  }

  function toggleOne(url: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(url);
      else next.delete(url);
      return next;
    });
  }

  function addJobs(jobs: BoardJob[]) {
    if (!jobs.length) return;
    startAdding(async () => {
      const res = await addDiscoveredJobsToPool(
        jobs.map((j) => ({
          company: j.company,
          title: j.title,
          location: j.location,
          url: j.url,
          description: j.description,
          source: j.sourceLabel || "全网实时搜岗",
        }))
      );
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setAddedUrls((prev) => {
        const next = new Set(prev);
        jobs.forEach((j) => next.add(j.url));
        return next;
      });
      toast.success(
        res.data.existed
          ? `已新加入 ${res.data.added} 个（${res.data.existed} 个已在候选池）`
          : `已加入 ${res.data.added} 个岗位到候选岗位池`
      );
      router.refresh();
    });
  }

  async function batchApplySelected() {
    if (!data) return;
    const chosen = data.jobs.filter((j) => selected.has(j.url));
    if (!chosen.length) {
      toast.error("请先勾选要投递的岗位");
      return;
    }
    const res = await launchBatchApply(
      chosen.map((j) => ({
        url: j.url,
        company: j.company,
        title: j.title,
        sourceLabel: j.sourceLabel || "全网搜岗",
      })),
      (href) => router.push(href)
    );
    toast.success(
      res.mode === "desktop"
        ? `已批量打开 ${res.count} 个网申页并在后台预填，顶部「待确认清单」统一核对提交`
        : `已生成 ${res.count} 个待投递链接`
    );
  }

  const jobs = data?.jobs ?? [];
  const allSelected = jobs.length > 0 && jobs.every((j) => selected.has(j.url));

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border bg-muted/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">全网校招与企业直招实时检索</p>
            <p className="text-xs text-muted-foreground">
              一次穿透企业直招官网（字节 / 腾讯 / 阿里 / 美团及名录官网）、已订阅校招表与全网招聘公告，自动过滤你已投过的岗位并按个人匹配度排序
            </p>
          </div>
          {defaultTrack && (
            <Button
              size="xs"
              variant="outline"
              disabled={searching}
              onClick={() => void handleSearch(defaultTrack)}
            >
              <Sparkles className="mr-1 size-3 text-primary" />
              一键按我的求职意向搜全网
            </Button>
          )}
        </div>

        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSearch();
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入岗位方向或公司名，如：嵌入式、字节 产品经理、Java 后端"
              className="pl-8"
            />
          </div>
          <Input
            value={cities}
            onChange={(e) => setCities(e.target.value)}
            placeholder="意向城市（如：深圳 上海 北京）"
            className="sm:w-52"
          />
          <Button type="submit" disabled={searching}>
            {searching ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Globe className="mr-1.5 size-4" />}
            {searching ? "全网检索中…" : "立即搜全网"}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">快速方向：</span>
            {QUICK_TOPICS.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => void handleSearch(topic)}
                className="rounded-full border bg-background px-2.5 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                {topic}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={includeBoards} onChange={(e) => setIncludeBoards(e.target.checked)} />
              企业官网直招
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={includeSheets} onChange={(e) => setIncludeSheets(e.target.checked)} />
              已订阅信息表
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={includeWeb} onChange={(e) => setIncludeWeb(e.target.checked)} />
              全网招聘公告
            </label>
          </div>
        </div>
      </div>

      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              找到 <strong>{data.total}</strong> 个尚未记录的新岗位（官网直招 {data.channels.boards} · 信息表 {data.channels.sheets} · 全网检索 {data.channels.web}）
            </span>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-2 text-sm">
              <span>已勾选 <strong>{selected.size}</strong> 个搜到的岗位</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void batchApplySelected()}>
                  <Rocket className="mr-1.5 size-3.5" />
                  批量打开网申并预填
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={adding}
                  onClick={() => addJobs(jobs.filter((j) => selected.has(j.url)))}
                >
                  <Plus className="mr-1.5 size-3.5" />
                  批量加入候选池
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  取消
                </Button>
              </div>
            </div>
          )}

          {jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              这次没有检索到未记录的新岗位。可以换更短的关键词（如只写「嵌入式」或「产品」），或勾选更多来源重试。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="w-9 px-3 py-2">
                      <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(v === true)} aria-label="全选" />
                    </th>
                    <th className="px-3 py-2 font-medium">公司 · 岗位</th>
                    <th className="px-3 py-2 font-medium">匹配度</th>
                    <th className="px-3 py-2 font-medium">地点</th>
                    <th className="px-3 py-2 font-medium">来源</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const added = addedUrls.has(job.url);
                    return (
                      <tr key={job.url} className="border-t align-top">
                        <td className="px-3 py-2.5">
                          <Checkbox
                            checked={selected.has(job.url)}
                            onCheckedChange={(v) => toggleOne(job.url, v === true)}
                            aria-label={`选择 ${job.company} ${job.title}`}
                          />
                        </td>
                        <td className="max-w-md px-3 py-2">
                          <p className="font-medium">
                            {job.company} · {job.title}
                          </p>
                          {job.description && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{job.description}</p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {job.match && job.match.score > 0 ? (
                            <div className="space-y-1">
                              <Badge
                                variant={job.match.tier === "high" ? "default" : "secondary"}
                                className={cn(
                                  "text-[11px] tabular-nums",
                                  job.match.tier === "high" && "bg-emerald-600 text-white hover:bg-emerald-600"
                                )}
                              >
                                {job.match.score}% 推荐
                              </Badge>
                              {job.match.reasons.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {job.match.reasons.map((r) => (
                                    <span key={r} className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{job.location || "—"}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          <Badge variant="outline">{job.sourceLabel || "官网"}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <Link
                              href={`/browser?url=${encodeURIComponent(job.url)}`}
                              className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                            >
                              投递
                              <ExternalLink className="size-3" />
                            </Link>
                            <Button
                              size="xs"
                              variant={added ? "ghost" : "outline"}
                              disabled={adding || added}
                              onClick={() => addJobs([job])}
                            >
                              {added ? "已加入" : "加入候选池"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
