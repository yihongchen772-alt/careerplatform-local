"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus, RefreshCw, Search, Sparkles, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPostingToPool, enableBuiltinPostingFeed, removePostingSource, savePostingSource, syncPostingSource, syncStalePostingSources, type SyncSummary } from "@/lib/actions/campus-postings";

function summaryText(result: SyncSummary) {
  const parts = [`共 ${result.total} 条`];
  if (result.added) parts.push(`新增 ${result.added}`);
  if (result.updated) parts.push(`更新 ${result.updated}`);
  if (result.removed) parts.push(`移除 ${result.removed}`);
  return parts.join("，");
}

/** No sheet yet: enable the built-in daily cloud feed with one click, or paste a 飞书 link. */
export function SubscribeCard() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [pending, startTransition] = useTransition();
  const [enablingFeed, startEnableFeed] = useTransition();
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
      const result = await enableBuiltinPostingFeed();
      if (!result.ok) { toast.error(result.message); return; }
      toast.success(`已开启「${result.data.name || "内置名企官网每日直招池"}」：${summaryText(result.data)}`);
      router.refresh();
    });
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-5 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <Sparkles className="size-4 text-primary" />
            内置名企官网每日直招池（免配置 · 开箱即用）
          </p>
          <p className="text-sm text-muted-foreground">
            无需寻找外部表格链接，一键接入 GitHub 云端每日自动聚合的名企官网直招池（涵盖字节、腾讯、阿里、美团、DeepSeek、月之暗面、智谱、MiniMax、博世、Databricks 等官方在招校招/实习/社招岗位），自动按你的简历计算匹配度排序。
          </p>
        </div>
        <Button type="button" onClick={enableBuiltin} disabled={enablingFeed || pending} className="shrink-0">
          {enablingFeed ? <><Loader2 className="animate-spin" />正在拉取直招池…</> : "一键开启每日直招池"}
        </Button>
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
  stale,
  hasBuiltinFeed = false,
  hasFeishuSheet = true,
}: {
  sourceId: string;
  stale: boolean;
  hasBuiltinFeed?: boolean;
  hasFeishuSheet?: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [enablingFeed, startEnableFeed] = useTransition();
  const [addingSheet, setAddingSheet] = useState(false);
  const [sheetLink, setSheetLink] = useState("");
  const [savingSheet, startSaveSheet] = useTransition();
  const autoRan = useRef(false);
  async function sync(auto: boolean) {
    setSyncing(true);
    try {
      const result = auto ? await syncStalePostingSources() : await syncPostingSource(sourceId);
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
      <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync(false)}>{syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}{syncing ? "同步中…" : "立即同步"}</Button>
      <Button size="sm" variant="ghost" disabled={syncing} title="取消订阅并清掉该源同步来的信息（已加入候选池的岗位保留）" onClick={async () => {
        if (!window.confirm("取消订阅这个数据源？同步来的招聘信息会清掉，已加入候选岗位池的不受影响。")) return;
        const result = await removePostingSource(sourceId);
        if (!result.ok) toast.error(result.message); else router.refresh();
      }}><Unlink />取消订阅</Button>
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
