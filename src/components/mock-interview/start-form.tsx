"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { startInterviewSession } from "@/lib/actions/interview-session";

type ResumeOption = { id: string; name: string };
type PositionOption = { id: string; label: string };

const NONE = "__none__";

export function MockInterviewStartForm({
  resumeVersions,
  positions,
  hasOwnKey,
}: {
  resumeVersions: ResumeOption[];
  positions: PositionOption[];
  hasOwnKey: boolean;
}) {
  const router = useRouter();
  const [resumeVersionId, setResumeVersionId] = useState(resumeVersions[0]?.id ?? "");
  const [positionId, setPositionId] = useState(NONE);
  const [targetRole, setTargetRole] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    if (!resumeVersionId) {
      toast.error("先去简历版本页添加一份简历，并跑一次 AI 体检");
      return;
    }
    setLoading(true);
    try {
      const res = await startInterviewSession({
        resumeVersionId,
        positionId: positionId === NONE ? undefined : positionId,
        targetRole: positionId === NONE ? targetRole || undefined : undefined,
      });
      if (res.ok) {
        router.push(`/mock-interview/${res.data.sessionId}`);
      } else {
        toast.error(res.message);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!hasOwnKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>开始新的模拟面试</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            这是多轮对话形式的模拟面试，每一轮都要调用一次 AI，比其他一次性生成的功能耗费多很多。
            请先去{" "}
            <a href="/settings" className="text-primary underline underline-offset-4">
              账号设置
            </a>{" "}
            配置你自己的 AI API Key 才能用。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>开始新的模拟面试</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {resumeVersions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有可用的简历——先去简历版本页添加一份简历并跑一次 AI 体检。
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">用哪份简历</Label>
              <Select
                value={resumeVersionId}
                onValueChange={(v) => v && setResumeVersionId(v)}
              >
                <SelectTrigger className="w-full sm:w-80">
                  <SelectValue>
                    {() =>
                      resumeVersions.find((r) => r.id === resumeVersionId)?.name
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

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                面试哪个岗位（可选，不选就按简历里的求职方向问通用问题）
              </Label>
              <Select value={positionId} onValueChange={(v) => v && setPositionId(v)}>
                <SelectTrigger className="w-full sm:w-80">
                  <SelectValue>
                    {() =>
                      positionId === NONE
                        ? "不选，问通用问题"
                        : positions.find((p) => p.id === positionId)?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>不选，问通用问题</SelectItem>
                  {positions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {positionId === NONE && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  目标方向（可选，比如&ldquo;后端开发&rdquo;）
                </Label>
                <Input
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  placeholder="不填就用简历里的求职方向"
                />
              </div>
            )}

            <Button onClick={handleStart} disabled={loading}>
              {loading ? "准备中..." : "开始面试"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
