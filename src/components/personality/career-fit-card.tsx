"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateCareerFitAnalysis } from "@/lib/actions/career-fit";
import type { CareerFitAnalysis } from "@/lib/validation";

export function CareerFitCard({
  hasAnyResult,
  initialResult,
}: {
  hasAnyResult: boolean;
  initialResult: CareerFitAnalysis | null;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CareerFitAnalysis | null>(initialResult);

  async function run() {
    setLoading(true);
    try {
      const res = await generateCareerFitAnalysis();
      if (res.ok) setResult(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  if (!hasAnyResult) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 综合分析</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              结合你做过的测试结果，生成一份常规的求职方向分析——适合什么方向、可以着重展现哪些优势、需要注意什么。
            </p>
            <Button onClick={run} disabled={loading}>
              <Sparkles />
              {loading ? "分析中..." : "生成分析"}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm">{result.summary}</p>

            <div className="space-y-2">
              <p className="text-sm font-medium">适合的方向</p>
              {result.recommendedDirections.map((d, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <p className="font-medium">{d.direction}</p>
                  <p className="text-sm text-muted-foreground">{d.reason}</p>
                </div>
              ))}
            </div>

            {result.strengths.length > 0 && (
              <div>
                <p className="text-sm font-medium">可以着重展现的优势</p>
                <ul className="list-inside list-disc text-sm text-muted-foreground">
                  {result.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.cautions.length > 0 && (
              <div>
                <p className="text-sm font-medium">需要注意的地方</p>
                <ul className="list-inside list-disc text-sm text-muted-foreground">
                  {result.cautions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={run} disabled={loading}>
              {loading ? "重新分析中..." : "重新分析"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
