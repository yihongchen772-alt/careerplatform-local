"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SendDigestButton } from "@/components/dashboard/send-digest-button";
import { bulkUpdateStage, undoBulkStage } from "@/lib/actions/schedule";
import type { Todo } from "@/lib/todos";
import { cn } from "@/lib/utils";

const URGENCY_STYLE: Record<Todo["urgency"], { badge: "destructive" | "secondary"; label: string }> = {
  overdue: { badge: "destructive", label: "已逾期" },
  urgent: { badge: "destructive", label: "很急" },
  soon: { badge: "secondary", label: "临近" },
};

/** 一个月没回音的校招，基本就是没过了。 */
const GIVE_UP_DAYS = 30;

/**
 * 待办: what has a date first. 投递 that have gone quiet used to be dozens of
 * red 「已逾期」 rows on top of everything; they are one folded line now,
 * with one click to close the ones silent for a month (撤销 in the toast).
 */
export function TodoCard({ todos }: { todos: Todo[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dated = todos.filter((todo) => todo.staleDays === undefined);
  const stale = todos.filter((todo) => todo.staleDays !== undefined);
  const silent = stale.filter((todo) => (todo.staleDays ?? 0) >= GIVE_UP_DAYS);

  async function closeSilent() {
    const ids = silent.map((todo) => todo.id.replace(/^stale-/, ""));
    setBusy(true);
    try {
      const result = await bulkUpdateStage(ids, "REJECTED");
      if (!result.ok) return void toast.error(result.message);
      router.refresh();
      toast.success(`已把 ${result.data.created.length} 条一个月没回音的投递标为未通过`, {
        duration: 10000,
        action: {
          label: "撤销",
          onClick: async () => {
            const undo = await undoBulkStage(result.data.created);
            if (!undo.ok) toast.error(undo.message);
            else { toast.success("已撤销"); router.refresh(); }
          },
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="surface-card rounded-xl">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>待办</CardTitle>
        <SendDigestButton />
      </CardHeader>
      <CardContent className="space-y-2">
        {!dated.length && !stale.length && (
          <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-5">
            <p className="text-sm font-medium">暂无待处理事项</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">有新的截止时间或阶段更新时，会自动出现在这里。</p>
          </div>
        )}
        {dated.map((todo) => <TodoRow key={todo.id} todo={todo} />)}
        {!!stale.length && (
          <div className="rounded-xl border border-border/60 bg-background/35">
            <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <Hourglass className="size-4 shrink-0 text-amber-500" />
              <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <span className="font-medium">{stale.length} 家投递久未回音</span>
                <span className="truncate text-xs text-muted-foreground">最久 {stale[0]?.staleDays} 天，可以催一下或标为结束</span>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
              </button>
              {!!silent.length && <Button size="sm" variant="outline" disabled={busy} onClick={closeSilent}>{silent.length} 家超过 {GIVE_UP_DAYS} 天：标为未通过</Button>}
            </div>
            {open && <div className="space-y-1.5 border-t border-border/50 p-2">{stale.map((todo) => <TodoRow key={todo.id} todo={todo} quiet />)}</div>}
          </div>
        )}
        {(!!dated.length || !!stale.length) && <p className="pt-1 text-xs text-muted-foreground">处理完对应记录（更新阶段、标记已投）后，这里会自动消失</p>}
      </CardContent>
    </Card>
  );
}

function TodoRow({ todo, quiet = false }: { todo: Todo; quiet?: boolean }) {
  const style = URGENCY_STYLE[todo.urgency];
  return (
    <Link href={todo.href} className={cn("flex flex-col gap-1 rounded-xl p-3 text-sm transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between", !quiet && "border border-border/60 bg-background/35")}>
      <div className="min-w-0">
        <p className="truncate font-medium">{todo.label}</p>
        <p className="text-xs text-muted-foreground">{todo.sublabel}</p>
      </div>
      {quiet ? <span className="shrink-0 text-xs text-muted-foreground">{todo.staleDays} 天</span> : <Badge variant={style.badge} className="self-start sm:self-auto">{style.label}</Badge>}
    </Link>
  );
}
