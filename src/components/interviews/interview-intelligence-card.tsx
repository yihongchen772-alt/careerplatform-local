"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BrainCircuit } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generateInterviewIntelligence,
  type InterviewIntelligence,
} from "@/lib/actions/interview-intelligence";

const PERFORMANCE_LABEL: Record<
  InterviewIntelligence["categories"][number]["performance"],
  { text: string; variant: "default" | "secondary" | "destructive" }
> = {
  strong: { text: "🟢 表现不错", variant: "default" },
  ok: { text: "🟡 一般/证据不足", variant: "secondary" },
  weak: { text: "🔴 需要加强", variant: "destructive" },
};

export function InterviewIntelligenceCard({
  initial,
}: {
  initial: InterviewIntelligence | null;
}) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await generateInterviewIntelligence();
      if (res.ok) setResult(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  const mixText = result?.nextSessionMix
    .map((m) => `${Math.round(m.percent)}% ${m.category}`)
    .join(" / ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <BrainCircuit className="size-4" />
          面试情报
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          汇总所有面经问题清单+单次面试复盘，看看各类别表现怎么样，下次模拟面试该往哪偏重
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" variant="outline" disabled={loading} onClick={generate}>
          {loading ? "分析中..." : result ? "重新分析" : "开始分析"}
        </Button>

        {!result ? (
          <p className="text-sm text-muted-foreground">
            还没分析过。需要先在投递记录的时间线里，给至少一条面试笔记跑过「AI 提取问题清单」或「AI 复盘这场面试」。
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{result.summary}</p>

            <div className="space-y-1.5">
              {result.categories.map((c, i) => (
                <div key={i} className="space-y-0.5 border-b pb-1.5 text-sm last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.category}</span>
                    <Badge variant={PERFORMANCE_LABEL[c.performance].variant} className="text-xs">
                      {PERFORMANCE_LABEL[c.performance].text}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.note}</p>
                </div>
              ))}
            </div>

            {result.nextSessionMix.length > 0 && (
              <div className="space-y-2 rounded-md bg-muted/40 p-2">
                <p className="text-sm font-medium">下次模拟面试建议配比</p>
                <p className="text-xs text-muted-foreground">{mixText}</p>
                <Link
                  href={`/mock-interview?focusMix=${encodeURIComponent(mixText ?? "")}`}
                  className={buttonVariants({ size: "sm", variant: "secondary" })}
                >
                  按此配比开始模拟面试
                </Link>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
