"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateSkillGapAnalysis, type SkillGapAnalysis } from "@/lib/actions/skill-gap";

type ResumeOption = { id: string; name: string };

const EVIDENCE_LABEL: Record<
  SkillGapAnalysis["skills"][number]["resumeEvidence"],
  { text: string; variant: "default" | "secondary" | "destructive" }
> = {
  strong: { text: "简历证据充分", variant: "default" },
  some: { text: "简历提及但笼统", variant: "secondary" },
  none: { text: "简历里没有", variant: "destructive" },
};

export function SkillGapCard({
  resumeVersions,
  defaultResumeVersionId,
  initialResults,
}: {
  resumeVersions: ResumeOption[];
  defaultResumeVersionId?: string | null;
  /** Keyed by resumeVersionId — whatever was already cached for each resume,
   * so switching the dropdown shows a previous result instead of forcing a
   * re-generate every time. */
  initialResults: Record<string, SkillGapAnalysis>;
}) {
  const [resumeVersionId, setResumeVersionId] = useState(
    defaultResumeVersionId ?? resumeVersions[0]?.id ?? ""
  );
  const [results, setResults] = useState(initialResults);
  const [loading, setLoading] = useState(false);

  const result = results[resumeVersionId];

  async function generate() {
    if (!resumeVersionId) return;
    setLoading(true);
    try {
      const res = await generateSkillGapAnalysis(resumeVersionId);
      if (res.ok) setResults((prev) => ({ ...prev, [resumeVersionId]: res.data }));
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  if (resumeVersions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Sparkles className="size-4" />
          技能证据链
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          JD 反复提到的技能 → 简历证据强不强 → 有没有被真实面试验证过，三层一起看
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={resumeVersionId} onValueChange={(v) => v && setResumeVersionId(v)}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue>
                {() => resumeVersions.find((r) => r.id === resumeVersionId)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {resumeVersions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={loading} onClick={generate}>
            {loading ? "分析中..." : result ? "重新分析" : "开始分析"}
          </Button>
        </div>

        {!result ? (
          <p className="text-sm text-muted-foreground">
            还没分析过这份简历，点「开始分析」看看。
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{result.summary}</p>
            <div className="space-y-1.5">
              {result.skills.map((s, i) => (
                <div key={i} className="space-y-1 border-b pb-1.5 text-sm last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.skill}</span>
                    <Badge variant="outline" className="text-xs">
                      {s.mentionCount} 篇提到
                    </Badge>
                    <Badge variant={EVIDENCE_LABEL[s.resumeEvidence].variant} className="text-xs">
                      {EVIDENCE_LABEL[s.resumeEvidence].text}
                    </Badge>
                  </div>
                  {s.interviewSignal && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">面试验证：</span>
                      {s.interviewSignal}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{s.note}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
