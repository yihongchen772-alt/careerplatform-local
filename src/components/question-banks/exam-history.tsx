"use client";

import Link from "next/link";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deleteExamSession, type ExamSummary } from "@/lib/actions/exam";

export function ExamHistory({ exams }: { exams: ExamSummary[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">模拟考试记录</h2>
      </div>
      <Card>
        <CardContent className="space-y-2 pt-4">
          {exams.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <Link
                href={`/question-banks/exam/${e.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
              >
                <span className="truncate">
                  {e.bankName}
                  {e.modules && e.modules.length > 0 && ` · ${e.modules.join("/")}`}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {e.questionCount} 题
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {e.status === "ACTIVE" ? (
                  <Badge variant="outline">进行中</Badge>
                ) : (
                  <Badge variant={e.overallScore != null && e.overallScore >= 60 ? "default" : "destructive"}>
                    {e.overallScore} 分
                  </Badge>
                )}
                <ConfirmDeleteButton
                  trigger={
                    <Button type="button" variant="ghost" size="sm" className="h-7">
                      删除
                    </Button>
                  }
                  title={`删除这场考试记录？`}
                  onConfirm={async () => {
                    const res = await deleteExamSession(e.id);
                    if (!res.ok) toast.error(res.message);
                    else toast.success("已删除");
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
