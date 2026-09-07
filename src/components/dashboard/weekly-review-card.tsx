"use client";

import { useState } from "react";
import { toast } from "sonner";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { generateWeeklyReview, type WeeklyReviewResult } from "@/lib/actions/weekly-review";

const STAT_LABELS: { key: keyof WeeklyReviewResult["stats"]; label: string }[] = [
  { key: "applicationsSubmitted", label: "本周投递" },
  { key: "stageAdvances", label: "阶段推进" },
  { key: "offers", label: "收到 offer" },
  { key: "rejections", label: "拒信/结束" },
  { key: "highMatchNotApplied", label: "高匹配未投" },
];

export function WeeklyReviewCard({ initial }: { initial: WeeklyReviewResult | null }) {
  const [review, setReview] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await generateWeeklyReview();
      if (res.ok) setReview(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1.5">
          <NotebookPen className="size-4" />
          本周复盘
        </CardTitle>
        {review !== null && (
          <Button variant="ghost" size="sm" disabled={loading} onClick={generate}>
            {loading ? "生成中..." : "重新生成"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {review === null ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              AI 结合本周投递数、阶段推进、候选池匹配情况，帮你复盘这周节奏怎么样、下周该做什么。
            </p>
            <Button size="sm" disabled={loading} onClick={generate}>
              {loading ? "生成中..." : "生成本周复盘"}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {review.weekStart} ~ {review.weekEnd}
            </p>
            <div className="flex flex-wrap gap-2">
              {STAT_LABELS.map(({ key, label }) => (
                <Badge key={key} variant="secondary">
                  {label} {review.stats[key] as number}
                </Badge>
              ))}
            </div>
            <p className="text-sm">{review.summary}</p>
            {review.highlights.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">做得好的</p>
                <ul className="list-inside list-disc space-y-0.5 text-sm">
                  {review.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.concerns.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">值得注意</p>
                <ul className="list-inside list-disc space-y-0.5 text-sm">
                  {review.concerns.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.suggestions.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">下周建议</p>
                <ul className="list-inside list-disc space-y-0.5 text-sm">
                  {review.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
