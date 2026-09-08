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
          跨岗位技能缺口
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          把候选池里带 JD 的岗位放一起看，哪些技能被反复提到，简历里还没体现
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
                <div key={i} className="flex flex-wrap items-start gap-2 border-b pb-1.5 text-sm last:border-0">
                  <span className="font-medium">{s.skill}</span>
                  <Badge variant="outline" className="text-xs">
                    {s.mentionCount} 篇提到
                  </Badge>
                  {s.onResume ? (
                    <Badge className="text-xs">简历已覆盖</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs">
                      简历里没有
                    </Badge>
                  )}
                  <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">
                    {s.note}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
