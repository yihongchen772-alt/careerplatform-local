"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generateDailyDigest,
  toggleDigestItem,
  type DigestItem,
} from "@/lib/actions/daily-digest";

function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DailyDigestCard({ initial }: { initial: DigestItem[] | null }) {
  const [items, setItems] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [togglingIndex, setTogglingIndex] = useState<number | null>(null);

  // Chained from the moment this renders, not from wall-clock times the AI
  // made up — models are unreliable at exactly this kind of arithmetic (see
  // the comment on DigestItem.estimatedMinutes). Recomputes whenever `items`
  // changes, so checking something off pushes the rest of today's blocks
  // forward from "now" rather than leaving them anchored to a stale start.
  const blocks = useMemo(() => {
    if (!items) return [];
    let cursor = new Date();
    return items.map((item) => {
      const start = new Date(cursor);
      const end = new Date(cursor.getTime() + item.estimatedMinutes * 60 * 1000);
      cursor = end;
      return `${formatClock(start)}–${formatClock(end)}`;
    });
  }, [items]);

  async function generate() {
    setLoading(true);
    try {
      const res = await generateDailyDigest();
      if (res.ok) setItems(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggle(index: number) {
    setTogglingIndex(index);
    try {
      const res = await toggleDigestItem(index);
      if (res.ok) setItems(res.data);
      else toast.error(res.message);
    } finally {
      setTogglingIndex(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="size-4" />
          今日优先级
        </CardTitle>
        {items !== null && (
          <Button variant="ghost" size="sm" disabled={loading} onClick={generate}>
            {loading ? "生成中..." : "重新生成"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {items === null ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              AI 综合紧迫程度、岗位匹配质量，帮你排出今天最值得做的几件事——不是简单按截止日期排序。
            </p>
            <Button size="sm" disabled={loading} onClick={generate}>
              {loading ? "生成中..." : "生成今日摘要"}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">今天没有特别需要优先处理的事</p>
        ) : (
          items.map((item, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-md border p-2 text-sm ${item.done ? "opacity-50" : ""}`}
            >
              <Checkbox
                className="mt-0.5 shrink-0"
                checked={item.done}
                disabled={togglingIndex !== null}
                onCheckedChange={() => toggle(i)}
              />
              <Link href={item.href} className="min-w-0 flex-1 hover:underline">
                <p className={`font-medium ${item.done ? "line-through" : ""}`}>{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {blocks[i]}（约 {item.estimatedMinutes} 分钟）
                </p>
              </Link>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
