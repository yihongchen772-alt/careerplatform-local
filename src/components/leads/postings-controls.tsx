"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Layers, Loader2, Plus, RefreshCw, Search, Sparkles, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_BUILTIN_SHARDS, FEED_SHARD_DEFS, type FeedMetaSummary, type FeedShardStat } from "@/lib/builtin-feed-shards";
import {
  addPostingToPool,
  enableBuiltinPostingFeed,
  removePostingSource,
  savePostingSource,
  syncAllPostingSources,
  syncPostingSource,
  syncStalePostingSources,
  updateBuiltinFeedShards,
  type SyncSummary,
} from "@/lib/actions/campus-postings";

function toggleShardId(current: string[], shardId: string): string[] {
  if (current.includes(shardId)) {
    return current.length > 1 ? current.filter((id) => id !== shardId) : current;
  }
  return [...current, shardId];
}

function formatCloudUpdatedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function ShardSelectorGrid({
  selected,
  onToggle,
  shardStats,
}: {
  selected: string[];
  onToggle: (shardId: string) => void;
  shardStats?: Record<string, FeedShardStat>;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {FEED_SHARD_DEFS.map((shard) => {
        const checked = selected.includes(shard.id);
        const stat = shardStats?.[shard.id];
        return (
          <label
            key={shard.id}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
              checked
                ? "border-primary/45 bg-primary/[0.06] text-foreground"
                : "border-border/70 bg-background/80 text-muted-foreground hover:border-border"
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              checked={checked}
              onChange={() => onToggle(shard.id)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-medium text-foreground">{shard.name}</span>
                {stat && stat.total > 0 && (
                  <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium tabular-nums text-primary">
                    {stat.boardsCount}家 · {stat.total.toLocaleString()}岗
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{shard.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function summaryText(result: SyncSummary) {
  const parts = [`共 ${result.total} 条`];
  if (result.added) parts.push(`新增 ${result.added}`);
  if (result.updated) parts.push(`更新 ${result.updated}`);
  if (result.removed) parts.push(`移除 ${result.removed}`);
  return parts.join("，");
}

/** No sheet yet: enable the built-in daily cloud feed with one click, or paste a 飞书 link. */
export function SubscribeCard({ feedMeta = null }: { feedMeta?: FeedMetaSummary | null }) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [selectedShards, setSelectedShards] = useState<string[]>(DEFAULT_BUILTIN_SHARDS);
  const [pending, startTransition] = useTransition();
  const [enablingFeed, startEnableFeed] = useTransition();
  const updatedText = formatCloudUpdatedAt(feedMeta?.generatedAt);
  function subscribe() {
    startTransition(async () => {
      const result = await savePostingSource(link);
      if (!result.ok) { toast.error(result.message); return; }
      toast.success(`已同步「${result.data.name || "校招信息表"}」：${summaryText(result.data)}`);
      router.refresh();
    });
  }
  function enableBuiltin() {
    startEnableFeed(async () => {
      const result = await enableBuiltinPostingFeed(selectedShards);
      if (!result.ok) { toast.error(result.message); return; }
      toast.success(`已开启「${result.data.name || "内置名企官网每日直招池"}」：${summaryText(result.data)}`);
      router.refresh();
    });
  }
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <p className="inline-flex flex-wrap items-center gap-1.5 font-medium">
              <Sparkles className="size-4 text-primary" />
              <span>名企官网每日直招池（分片订阅 · 免配置 · 一键填表直达）</span>
              {feedMeta && feedMeta.total > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                  云端在招 {feedMeta.total.toLocaleString()} 岗{updatedText ? ` · ${updatedText} 更新` : ""}
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              内置 <strong>350+ 家</strong> 官网直招站点：核心池默认开启 <strong>Moka / 北森 / 飞书招聘</strong> 三大标准系统；可按需勾选 <strong>大易 Dayee / 腾讯阿里美团 / 全球前沿 AI &amp; 机器人外企</strong> 分片。
            </p>
          </div>
          <Button type="button" onClick={enableBuiltin} disabled={enablingFeed || pending} className="shrink-0">
            {enablingFeed ? <><Loader2 className="animate-spin" />正在拉取直招池…</> : `开启所选 ${selectedShards.length} 个分片`}
          </Button>
        </div>
        <ShardSelectorGrid
          selected={selectedShards}
          shardStats={feedMeta?.shards}
          onToggle={(id) => setSelectedShards((prev) => toggleShardId(prev, id))}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-dashed p-5">
        <div>
          <p className="font-medium">或者订阅一份在线飞书校招信息表（可同时叠加）</p>
          <p className="mt-1 text-sm text-muted-foreground">把买到或群里分享的飞书多维表格链接贴进来，求职罗盘会把整张表读进来，每天自动同步；之后在这里按今日新增、快截止、届次和行业筛，点「投递」直接在网申浏览器打开。</p>
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); subscribe(); }}>
          <Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://xxxx.feishu.cn/base/……（复制完整链接）" aria-label="飞书表格链接" className="flex-1" />
          <Button type="submit" variant="outline" disabled={pending || enablingFeed || !link.trim()}>{pending ? <><Loader2 className="animate-spin" />读取中，大表要十几秒…</> : "订阅并同步"}</Button>
        </form>
        <p className="text-xs text-muted-foreground">只读表格内容，不需要飞书账号；链接只保存在这台电脑上。</p>
      </div>
    </div>
  );
}

/** 立即同步 / 取消订阅, plus a quiet sync when the last one is over 12 hours old. */
export function SyncControls({
  sourceId,
  sources,
  stale,
  hasBuiltinFeed = false,
  builtinShards,
  feedMeta = null,
  hasFeishuSheet = true,
}: {
  sourceId: string;
  sources?: { id: string; name: string }[];
  stale: boolean;
  hasBuiltinFeed?: boolean;
  builtinShards?: string[];
  feedMeta?: FeedMetaSummary | null;
  hasFeishuSheet?: boolean;
}) {
  const cloudUpdatedText = formatCloudUpdatedAt(feedMeta?.generatedAt);
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [enablingFeed, startEnableFeed] = useTransition();
  const [editingShards, setEditingShards] = useState(false);
  const activeShards = builtinShards?.length ? builtinShards : DEFAULT_BUILTIN_SHARDS;
  const [draftShards, setDraftShards] = useState<string[]>(activeShards);
  const [savingShards, startSaveShards] = useTransition();
  const [addingSheet, setAddingSheet] = useState(false);
  const [sheetLink, setSheetLink] = useState("");
  const [savingSheet, startSaveSheet] = useTransition();
  const autoRan = useRef(false);
  const sourceList = sources && sources.length > 0 ? sources : [{ id: sourceId, name: "当前数据源" }];
  async function sync(auto: boolean) {
    setSyncing(true);
    try {
      const result = auto
        ? await syncStalePostingSources()
        : sourceList.length > 1
          ? await syncAllPostingSources()
          : await syncPostingSource(sourceId);
      if (!result.ok) { if (!auto) toast.error(result.message); return; }
      if (result.data && (!auto || result.data.added || result.data.updated)) toast.success(`招聘信息池已同步：${summaryText(result.data)}`);
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    if (!stale || autoRan.current) return;
    autoRan.current = true;
    void sync(true);
    // Once per visit, when the page first shows a stale sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!hasBuiltinFeed && (
          <Button
            size="sm"
            variant="outline"
            disabled={syncing || enablingFeed}
            onClick={() =>
              startEnableFeed(async () => {
                const result = await enableBuiltinPostingFeed();
                if (!result.ok) { toast.error(result.message); return; }
                toast.success(`已开启「${result.data.name || "内置名企官网每日直招池"}」：${summaryText(result.data)}`);
                router.refresh();
              })
            }
          >
            {enablingFeed ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {enablingFeed ? "正在开启…" : "+ 开启名企直招池"}
          </Button>
        )}
        {hasBuiltinFeed && (
          <Button
            size="sm"
            variant={editingShards ? "secondary" : "outline"}
            disabled={syncing || savingShards}
            onClick={() => {
              if (!editingShards) setDraftShards(activeShards);
              setEditingShards((v) => !v);
            }}
          >
            <Layers />
            直招赛道分片 ({activeShards.length}/{FEED_SHARD_DEFS.length})
          </Button>
        )}
        {!hasFeishuSheet && !addingSheet && (
          <Button size="sm" variant="outline" disabled={syncing} onClick={() => setAddingSheet(true)}>
            <Plus />
            叠加飞书校招表
          </Button>
        )}
        {addingSheet && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              startSaveSheet(async () => {
                const result = await savePostingSource(sheetLink);
                if (!result.ok) { toast.error(result.message); return; }
                toast.success(`已同步「${result.data.name || "校招信息表"}」：${summaryText(result.data)}`);
                setAddingSheet(false);
                setSheetLink("");
                router.refresh();
              });
            }}
          >
            <Input
              value={sheetLink}
              onChange={(e) => setSheetLink(e.target.value)}
              placeholder="https://xxxx.feishu.cn/base/……"
              className="h-8 w-56 text-xs"
            />
            <Button size="sm" type="submit" disabled={savingSheet || !sheetLink.trim()}>
              {savingSheet ? <Loader2 className="animate-spin" /> : "订阅"}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setAddingSheet(false)}>
              取消
            </Button>
          </form>
        )}
        <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync(false)}>{syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}{syncing ? "同步中…" : sourceList.length > 1 ? "全部同步" : "立即同步"}</Button>
        {sourceList.length === 1 ? (
          <Button size="sm" variant="ghost" disabled={syncing} title="取消订阅并清掉该源同步来的信息（已加入候选池的岗位保留）" onClick={async () => {
            if (!window.confirm("取消订阅这个数据源？同步来的招聘信息会清掉，已加入候选岗位池的不受影响。")) return;
            const result = await removePostingSource(sourceId);
            if (!result.ok) toast.error(result.message); else router.refresh();
          }}><Unlink />取消订阅</Button>
        ) : (
          sourceList.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant="ghost"
              disabled={syncing}
              title={`移除数据源「${s.name}」`}
              onClick={async () => {
                if (!window.confirm(`移除数据源「${s.name}」？它同步来的信息会清掉，已加入候选池的保留。`)) return;
                const result = await removePostingSource(s.id);
                if (!result.ok) toast.error(result.message); else router.refresh();
              }}
            >
              <Unlink />移除{s.name.slice(0, 6)}
            </Button>
          ))
        )}
      </div>
      {hasBuiltinFeed && editingShards && (
        <div className="w-full max-w-3xl space-y-2.5 rounded-xl border bg-background/95 p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">
              按赛道与平台选择同步分片（勾选越多岗位越全，仅拉取所选分片，同步更快{cloudUpdatedText ? ` · 云端更新：${cloudUpdatedText}` : ""}）
            </p>
            <div className="flex items-center gap-1.5">
              <Button size="xs" variant="ghost" disabled={savingShards} onClick={() => setEditingShards(false)}>
                收起
              </Button>
              <Button
                size="xs"
                disabled={savingShards || draftShards.length === 0}
                onClick={() =>
                  startSaveShards(async () => {
                    const result = await updateBuiltinFeedShards(draftShards);
                    if (!result.ok) { toast.error(result.message); return; }
                    setEditingShards(false);
                    toast.success(`分片配置已更新并同步：${summaryText(result.data)}`);
                    router.refresh();
                  })
                }
              >
                {savingShards ? <Loader2 className="animate-spin" /> : null}
                保存分片并同步
              </Button>
            </div>
          </div>
          <ShardSelectorGrid
            selected={draftShards}
            shardStats={feedMeta?.shards}
            onToggle={(id) => setDraftShards((prev) => toggleShardId(prev, id))}
          />
        </div>
      )}
    </div>
  );
}

/** 「加入」: into the 候选岗位池 as a 待投递. */
export function AddToPoolButton({ postingId, added }: { postingId: string; added: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState(added);
  const [pending, startTransition] = useTransition();
  if (done) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" />已加入</span>;
  return (
    <Button size="xs" variant="outline" disabled={pending} title="加入候选岗位池，之后在那里一键打开网申、准备材料" onClick={() => startTransition(async () => {
      const result = await addPostingToPool(postingId);
      if (!result.ok) { toast.error(result.message); return; }
      setDone(true);
      toast.success(result.data.existed ? "候选岗位池里已经有这个岗位了" : "已加入候选岗位池");
      router.refresh();
    })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />}加入</Button>
  );
}

/** Search box: a plain GET form, so the filters live in the address. */
export function PostingSearch({ q, hidden }: { q: string; hidden: Record<string, string> }) {
  return (
    <form action="/leads" className="relative min-w-56 flex-1">
      <input type="hidden" name="view" value="postings" />
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input name="q" defaultValue={q} placeholder="搜公司、岗位方向、城市、行业" className="pl-8" aria-label="搜索招聘信息" />
    </form>
  );
}
