"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { checkResume } from "@/lib/actions/resume-check";
import type { ResumeCheck } from "@/lib/validation";

const SEVERITY: Record<
  ResumeCheck["issues"][number]["severity"],
  { label: string; variant: "destructive" | "secondary" | "outline" }
> = {
  high: { label: "重要", variant: "destructive" },
  medium: { label: "建议改", variant: "secondary" },
  low: { label: "可选", variant: "outline" },
};

export function ResumeCheckDialog({
  resumeVersionId,
  resumeName,
  hasFile,
  initialResult,
  checkedAt,
}: {
  resumeVersionId: string;
  resumeName: string;
  hasFile: boolean;
  initialResult: ResumeCheck | null;
  checkedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResumeCheck | null>(initialResult);

  async function run() {
    setLoading(true);
    const res = await checkResume(resumeVersionId);
    setLoading(false);
    if (res.ok) setResult(res.data);
    else toast.error(res.message);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" disabled={!hasFile}>
            <Sparkles />
            AI 体检
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>简历体检 · {resumeName}</DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              AI 会通读这份简历，给出完整度、成果量化、表达清晰度的评分和具体修改建议。
            </p>
            <Button onClick={run} disabled={loading}>
              {loading ? "体检中，约需十几秒..." : "开始体检"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-semibold tabular-nums">
                {result.score}
              </span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              {checkedAt && !loading && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(checkedAt).toLocaleDateString()} 体检
                </span>
              )}
            </div>

            <p className="text-sm">{result.summary}</p>

            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="完整度" value={result.completeness} />
              <Metric label="成果量化" value={result.quantification} />
              <Metric label="表达清晰" value={result.clarity} />
            </div>

            {result.strengths.length > 0 && (
              <Section title="做得好的地方">
                {result.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </Section>
            )}

            {result.issues.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">发现的问题</p>
                {result.issues.map((issue, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <Badge
                      variant={SEVERITY[issue.severity].variant}
                      className="mt-0.5 shrink-0"
                    >
                      {SEVERITY[issue.severity].label}
                    </Badge>
                    <span>{issue.text}</span>
                  </div>
                ))}
              </div>
            )}

            {result.suggestions.length > 0 && (
              <Section title="改进建议">
                {result.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </Section>
            )}

            <Button variant="outline" size="sm" onClick={run} disabled={loading}>
              {loading ? "重新体检中..." : "重新体检"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
        {children}
      </ul>
    </div>
  );
}
