"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateDailyDigest, type DigestItem } from "@/lib/actions/daily-digest";

export function DailyDigestCard({ initial }: { initial: DigestItem[] | null }) {
  const [items, setItems] = useState(initial);
  const [loading, setLoading] = useState(false);

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
            <Link
              key={i}
              href={item.href}
              className="block rounded-md border p-2 text-sm hover:bg-muted"
            >
              <p className="font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.reason}</p>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
