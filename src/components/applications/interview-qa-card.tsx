"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateInterviewQa } from "@/lib/actions/interview-qa";
import type { InterviewQa } from "@/lib/validation";

type ResumeOption = { id: string; name: string };

export function InterviewQaCard({
  applicationId,
  resumeVersions,
  defaultResumeVersionId,
  initialResult,
}: {
  applicationId: string;
  resumeVersions: ResumeOption[];
  defaultResumeVersionId: string | null;
  initialResult: InterviewQa | null;
}) {
  const [loading, setLoading] = useState(false);
  const [resumeVersionId, setResumeVersionId] = useState(
    defaultResumeVersionId ?? resumeVersions[0]?.id ?? ""
  );
  const [result, setResult] = useState<InterviewQa | null>(initialResult);

  async function run() {
    if (!resumeVersionId) {
      toast.error("先去简历版本页添加一份简历");
      return;
    }
    setLoading(true);
    try {
      const res = await generateInterviewQa(applicationId, resumeVersionId);
      if (res.ok) setResult(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 模拟面试题库</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {resumeVersions.length > 1 && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">用哪份简历</label>
            <Select
              value={resumeVersionId}
              onValueChange={(v) => v && setResumeVersionId(v)}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue>
                  {() =>
                    resumeVersions.find((r) => r.id === resumeVersionId)?.name ??
                    "选择简历版本"
                  }
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
          </div>
        )}

        {!result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              结合简历和这条投递的岗位信息，生成一套模拟面试题和参考答题思路。
            </p>
            <Button onClick={run} disabled={loading}>
              <Sparkles />
              {loading ? "生成中，约需十几秒..." : "生成题库"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">{result.summary}</p>

            {result.questions.map((q, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{q.question}</p>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {q.category}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    参考答题思路
                  </p>
                  <p className="text-sm">{q.referenceAnswer}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">技巧</p>
                  <p className="text-sm text-muted-foreground">{q.tips}</p>
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={run} disabled={loading}>
              {loading ? "重新生成中..." : "重新生成"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
