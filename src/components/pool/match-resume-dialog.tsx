"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  matchResumesToPosition,
  type MatchResult,
  type ResumeMatch,
} from "@/lib/actions/resume-match";

const RECOMMENDATION_VARIANT: Record<
  ResumeMatch["recommendation"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  强烈建议投: "default",
  可以投: "secondary",
  海投备用: "outline",
  不建议浪费时间: "destructive",
};

const VERDICT_ICON: Record<ResumeMatch["breakdown"][number]["verdict"], string> = {
  match: "✅",
  partial: "⚠️",
  missing: "❌",
};

export function MatchResumeDialog({
  positionId,
  positionLabel,
  open,
  onOpenChange,
}: {
  positionId: string;
  positionLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await matchResumesToPosition(positionId);
      if (res.ok) setResult(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>该用哪版简历投？</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{positionLabel}</p>

        {!result ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              AI 会把你已上传的每个简历版本都跟这个岗位比一遍，按匹配度排序（最多比 5 份）。
            </p>
            <Button onClick={run} disabled={loading}>
              {loading ? "分析中，可能要几十秒..." : "开始匹配"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {result.coarse && (
              <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                这个岗位没有保存 JD 正文，匹配只能基于岗位名称和方向判断，结论较粗。
                下次添加岗位时粘贴 JD 文字，结果会准很多。
              </p>
            )}

            {result.matches.map((m, i) => (
              <div key={m.resumeVersionId} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.resumeName}</span>
                  {i === 0 && <Badge>推荐</Badge>}
                  <Badge variant={RECOMMENDATION_VARIANT[m.recommendation]}>
                    {m.recommendation}
                  </Badge>
                  <span className="ml-auto text-lg font-semibold tabular-nums">
                    {m.matchScore}
                  </span>
                </div>

                {m.breakdown.length > 0 && (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                          <th className="px-2 py-1.5 font-medium">JD 要求</th>
                          <th className="px-2 py-1.5 font-medium">简历里的证据</th>
                          <th className="w-8 px-2 py-1.5 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.breakdown.map((row, j) => (
                          <tr key={j} className="border-b last:border-b-0">
                            <td className="px-2 py-1.5 align-top">{row.requirement}</td>
                            <td className="px-2 py-1.5 align-top text-muted-foreground">
                              {row.evidence}
                            </td>
                            <td className="px-2 py-1.5 text-center align-top">
                              {VERDICT_ICON[row.verdict]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="text-sm">{m.suggestion}</p>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={run} disabled={loading}>
              {loading ? "重新分析中..." : "重新分析"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MatchResumeTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <FileSearch />
      选简历
    </Button>
  );
}
