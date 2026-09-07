"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Handshake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { analyzeOffer, type OfferAnalysis } from "@/lib/actions/offer-negotiation";

const CONFIDENCE = {
  high: { label: "可信度较高", variant: "default" as const },
  medium: { label: "可信度中等", variant: "secondary" as const },
  low: { label: "几乎没查到", variant: "outline" as const },
};

export function OfferAnalysisDialog({
  applicationId,
  offerLabel,
}: {
  applicationId: string;
  offerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OfferAnalysis | null>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await analyzeOffer(applicationId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setResult(res.data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Handshake className="size-4" />
        分析 offer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Offer 分析 · {offerLabel}</DialogTitle>
          </DialogHeader>

          {!result ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                结合你填的 offer 条件，联网查同城市同职级的市场行情、这家公司好不好谈薪，
                给出值不值、怎么跟 HR 谈的建议。
              </p>
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                offer 条件（薪资/通勤/加班/发展空间等）来自你在这条投递记录里填的信息——先把这些
                填完整，分析才准。市场行情来自公开网页，查不到的会如实说查不到，不会拿同类公司
                的印象凑数。
              </p>
              <Button type="button" onClick={run} disabled={loading}>
                <Handshake />
                {loading ? "联网分析中，约需二十几秒..." : "开始分析"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={CONFIDENCE[result.confidence].variant}>
                  {CONFIDENCE[result.confidence].label}
                </Badge>
                <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={run}>
                  {loading ? "重新分析中..." : "重新分析"}
                </Button>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium">值不值</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{result.verdict}</p>
              </div>

              {result.marketComparison && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">市场行情对比</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {result.marketComparison}
                  </p>
                </div>
              )}

              {result.negotiationPoints.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">可以怎么谈</p>
                  <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                    {result.negotiationPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.risks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">值得注意的风险</p>
                  <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                    {result.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {result.caveat}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
