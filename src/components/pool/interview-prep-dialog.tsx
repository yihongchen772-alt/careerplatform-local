"use client";

import { useState } from "react";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  generateInterviewPrep,
} from "@/lib/actions/interview-prep";
import { generateGroupInterviewPrep } from "@/lib/actions/group-interview-prep";
import type { InterviewPrep, GroupInterviewPrep } from "@/lib/validation";

type ResumeOption = { id: string; name: string };
type Mode = "individual" | "group";

export function InterviewPrepDialog({
  positionId,
  positionLabel,
  resumeVersions,
  defaultResumeVersionId,
  initialResult,
  initialGroupResult,
  open,
  onOpenChange,
}: {
  positionId: string;
  positionLabel: string;
  resumeVersions: ResumeOption[];
  defaultResumeVersionId?: string | null;
  initialResult: InterviewPrep | null;
  initialGroupResult: GroupInterviewPrep | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("individual");
  const [loading, setLoading] = useState(false);
  const [resumeVersionId, setResumeVersionId] = useState(
    defaultResumeVersionId ?? resumeVersions[0]?.id ?? ""
  );
  const [result, setResult] = useState<InterviewPrep | null>(initialResult);
  const [groupResult, setGroupResult] = useState<GroupInterviewPrep | null>(
    initialGroupResult
  );

  async function run() {
    if (!resumeVersionId) {
      toast.error("先去简历版本页添加一份简历");
      return;
    }
    setLoading(true);
    try {
      if (mode === "individual") {
        const res = await generateInterviewPrep(positionId, resumeVersionId);
        if (res.ok) setResult(res.data);
        else toast.error(res.message);
      } else {
        const res = await generateGroupInterviewPrep(positionId, resumeVersionId);
        if (res.ok) setGroupResult(res.data);
        else toast.error(res.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>投递前面试攻略</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{positionLabel}</p>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">用哪份简历</label>
          <Select
            value={resumeVersionId}
            onValueChange={(v) => v && setResumeVersionId(v)}
          >
            <SelectTrigger className="w-full">
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

        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={mode === "individual" ? "secondary" : "ghost"}
            onClick={() => setMode("individual")}
          >
            一对一攻略
          </Button>
          <Button
            size="sm"
            variant={mode === "group" ? "secondary" : "ghost"}
            onClick={() => setMode("group")}
          >
            群面攻略
          </Button>
        </div>

        {mode === "individual" ? (
          !result ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                还没投递的话，可以先看看这个岗位大概率考什么、简历里哪些地方需要提前补强。
              </p>
              <Button onClick={run} disabled={loading}>
                {loading ? "生成中，约需十几秒..." : "生成攻略"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">{result.summary}</p>

              <div className="space-y-2">
                <p className="text-sm font-medium">重点准备方向</p>
                {result.focusAreas.map((f, i) => (
                  <div key={i} className="space-y-1 rounded-lg border p-3">
                    <p className="font-medium">{f.title}</p>
                    <p className="text-sm text-muted-foreground">{f.why}</p>
                    <p className="text-sm">{f.whatToPrepare}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium">大概率会问的题型</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.likelyQuestionTypes.map((t, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-muted px-2.5 py-1 text-xs"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={run} disabled={loading}>
                {loading ? "重新生成中..." : "重新生成"}
              </Button>
            </div>
          )
        ) : !groupResult ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              群面（无领导小组讨论）考的是角色定位、发言时机和协作表现，跟一对一面试完全不是一回事。
            </p>
            <Button onClick={run} disabled={loading}>
              {loading ? "生成中，约需十几秒..." : "生成群面攻略"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">{groupResult.overview}</p>

            <div className="space-y-1">
              <p className="text-sm font-medium">适合你的角色定位</p>
              <p className="text-sm text-muted-foreground">{groupResult.roleStrategy}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">具体技巧</p>
              {groupResult.tips.map((t, i) => (
                <div key={i} className="space-y-1 rounded-lg border p-3">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-sm text-muted-foreground">{t.detail}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">常见减分行为</p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {groupResult.pitfalls.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-1 rounded-lg border p-3">
              <p className="text-sm font-medium">练习话题</p>
              <p className="text-sm">{groupResult.practiceTopic.topic}</p>
              <p className="text-sm text-muted-foreground">
                {groupResult.practiceTopic.instructions}
              </p>
            </div>

            <Button variant="outline" size="sm" onClick={run} disabled={loading}>
              {loading ? "重新生成中..." : "重新生成"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InterviewPrepTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <GraduationCap />
      面试攻略
    </Button>
  );
}
