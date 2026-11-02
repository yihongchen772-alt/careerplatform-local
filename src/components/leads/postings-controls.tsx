"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus, RefreshCw, Search, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPostingToPool, removePostingSource, savePostingSource, syncPostingSource, syncStalePostingSources, type SyncSummary } from "@/lib/actions/campus-postings";

function summaryText(result: SyncSummary) {
  const parts = [`共 ${result.total} 条`];
  if (result.added) parts.push(`新增 ${result.added}`);
  if (result.updated) parts.push(`更新 ${result.updated}`);
  if (result.removed) parts.push(`移除 ${result.removed}`);
  return parts.join("，");
}

/** No sheet yet: paste the 飞书 link once, it syncs right away and then every day. */
export function SubscribeCard() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [pending, startTransition] = useTransition();
  function subscribe() {
    startTransition(async () => {
      const result = await savePostingSource(link);
      if (!result.ok) { toast.error(result.message); return; }
      toast.success(`已同步「${result.data.name || "校招信息表"}」：${summaryText(result.data)}`);
      router.refresh();
    });
  }
  return (
    <div className="space-y-3 rounded-xl border border-dashed p-5">
      <div>
        <p className="font-medium">订阅一份在线校招信息表</p>
        <p className="mt-1 text-sm text-muted-foreground">把买到或群里分享的飞书多维表格链接贴进来，求职罗盘会把整张表读进来，每天自动同步；之后在这里按今日新增、快截止、届次和行业筛，点「投递」直接在网申浏览器打开。</p>
      </div>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); subscribe(); }}>
        <Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://xxxx.feishu.cn/base/……（复制完整链接）" aria-label="飞书表格链接" className="flex-1" />
        <Button type="submit" disabled={pending || !link.trim()}>{pending ? <><Loader2 className="animate-spin" />读取中，大表要十几秒…</> : "订阅并同步"}</Button>
      </form>
      <p className="text-xs text-muted-foreground">只读表格内容，不需要飞书账号；链接只保存在这台电脑上。</p>
    </div>
  );
}

/** 立即同步 / 取消订阅, plus a quiet sync when the last one is over 12 hours old. */
export function SyncControls({ sourceId, stale }: { sourceId: string; stale: boolean }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const autoRan = useRef(false);
  async function sync(auto: boolean) {
    setSyncing(true);
    try {
      const result = auto ? await syncStalePostingSources() : await syncPostingSource(sourceId);
      if (!result.ok) { if (!auto) toast.error(result.message); return; }
      if (result.data && (!auto || result.data.added || result.data.updated)) toast.success(`校招信息表已同步：${summaryText(result.data)}`);
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
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync(false)}>{syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}{syncing ? "同步中…" : "立即同步"}</Button>
      <Button size="sm" variant="ghost" disabled={syncing} title="取消订阅并清掉这张表同步来的信息（已加入候选池的岗位保留）" onClick={async () => {
        if (!window.confirm("取消订阅这张表？同步来的招聘信息会清掉，已加入候选岗位池的不受影响。")) return;
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
