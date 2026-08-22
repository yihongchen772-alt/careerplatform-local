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
} from "@/lib/actions/resume-match";

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
                  <span className="ml-auto text-lg font-semibold tabular-nums">
                    {m.matchScore}
                  </span>
                </div>

                {m.matchedPoints.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">对得上的点</p>
                    <ul className="list-inside list-disc text-sm">
                      {m.matchedPoints.map((p, j) => (
                        <li key={j}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {m.gaps.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">差距</p>
                    <ul className="list-inside list-disc text-sm text-muted-foreground">
                      {m.gaps.map((g, j) => (
                        <li key={j}>{g}</li>
                      ))}
                    </ul>
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
