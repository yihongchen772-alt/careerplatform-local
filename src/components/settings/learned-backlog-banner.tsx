"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookmarkCheck, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { dismissBacklogNotices } from "@/lib/actions/profile-backlog";

type Notice = { id: string; label: string };

/**
 * 「已把你以前手填的记进网申资料」 after the 待核对 backlog was learned:
 * what was written, a link to check it, and one click to take it all back.
 */
export function LearnedBacklogBanner({ notices, showLink = false }: { notices: Notice[]; showLink?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"shown" | "undoing" | "closed">("shown");
  if (!notices.length || state === "closed") return null;
  const names = notices.map((notice) => notice.label);

  async function undo() {
    setState("undoing");
    try {
      const res = await fetch("/api/desktop-browser/undo-learned", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: notices.map((notice) => notice.id) }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "撤销失败");
      toast.success(body.kept ? `已撤销 ${body.undone} 项；${body.kept} 项你之后改过，保留不动` : "已撤销，网申资料恢复原样");
      setState("closed");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "撤销失败");
      setState("shown");
    }
  }

  return (
    <div role="status" className="surface-card flex items-start gap-3 rounded-2xl px-4 py-3 text-sm">
      <BookmarkCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">已把你以前在网申里手填的 {notices.length} 项记进网申资料，下次自动填</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={names.join("、")}>{names.slice(0, 6).join("、")}{names.length > 6 ? ` 等 ${names.length} 项` : ""}</p>
      </div>
      {showLink && <Link href="/settings?tab=autofill" className={buttonVariants({ size: "sm", variant: "ghost" })}>去看看</Link>}
      <Button size="sm" variant="outline" disabled={state === "undoing"} onClick={undo}>{state === "undoing" ? "撤销中…" : "撤销"}</Button>
      <button type="button" aria-label="关闭" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => { setState("closed"); void dismissBacklogNotices(notices.map((notice) => notice.id)); }}><X className="size-4" /></button>
    </div>
  );
}
