"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatPercent,
  SMALL_SAMPLE_THRESHOLD,
  type ResumeComparisonRow,
} from "@/lib/analytics";
import { generateResumeComparisonNarrative } from "@/lib/actions/resume-comparison";

export function ResumeComparisonCard({
  rows,
  initialNarrative,
}: {
  rows: ResumeComparisonRow[];
  initialNarrative: string | null;
}) {
  const [narrative, setNarrative] = useState(initialNarrative);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await generateResumeComparisonNarrative();
      if (res.ok) setNarrative(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <FlaskConical className="size-4" />
          简历版本 A/B 对比
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          按简历版本拆出投递/笔试/面试/Offer 各阶段的转化，看哪个版本实际更能打
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">简历版本</th>
                <th className="px-2 py-1.5 font-medium">投递</th>
                <th className="px-2 py-1.5 font-medium">笔试</th>
                <th className="px-2 py-1.5 font-medium">面试</th>
                <th className="px-2 py-1.5 font-medium">Offer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b last:border-b-0">
                  <td className="px-2 py-1.5 align-top font-medium">
                    {r.name}
                    {r.smallSample && (
                      <Badge variant="outline" className="ml-1.5 text-xs">
                        样本少
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top">{r.total}</td>
                  <td className="px-2 py-1.5 align-top">
                    {r.assessment}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      ({formatPercent(r.assessmentRate)})
                    </span>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {r.interview}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      ({formatPercent(r.interviewRate)})
                    </span>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {r.offers}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      ({formatPercent(r.offerRate)})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.some((r) => r.smallSample) && (
          <p className="text-xs text-muted-foreground">
            标&ldquo;样本少&rdquo;的是投递不足 {SMALL_SAMPLE_THRESHOLD} 条的版本，比例波动大。
          </p>
        )}

        {rows.length >= 2 &&
          (!narrative ? (
            <Button size="sm" variant="outline" disabled={loading} onClick={generate}>
              {loading ? "分析中..." : "AI 分析对比"}
            </Button>
          ) : (
            <div className="space-y-2 rounded-md bg-muted/40 p-2">
              <p className="text-sm">{narrative}</p>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={loading} onClick={generate}>
                {loading ? "重新分析中..." : "重新分析"}
              </Button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
