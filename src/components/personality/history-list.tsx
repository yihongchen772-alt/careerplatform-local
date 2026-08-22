"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deletePersonalityTestResult } from "@/lib/actions/personality-tests";
import { PERSONALITY_TESTS } from "@/lib/personality-tests";
import type { PersonalityTestType } from "@prisma/client";

export type HistoryRow = {
  id: string;
  testType: PersonalityTestType;
  resultLabel: string;
  createdAt: string;
};

export function PersonalityHistoryList({ results }: { results: HistoryRow[] }) {
  async function handleDelete(id: string) {
    try {
      await deletePersonalityTestResult(id);
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  }

  return (
    <div className="space-y-2">
      {results.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="outline">{PERSONALITY_TESTS[r.testType].title}</Badge>
            <span className="truncate font-medium">{r.resultLabel}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(r.createdAt).toLocaleDateString()}
            </span>
          </div>
          <ConfirmDeleteButton
            trigger={
              <Button size="sm" variant="ghost">
                删除
              </Button>
            }
            title="确定删除这条测试记录吗？"
            onConfirm={() => handleDelete(r.id)}
          />
        </div>
      ))}
    </div>
  );
}
