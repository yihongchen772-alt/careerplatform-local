"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  PersonalTaskFormDialog,
  type PersonalTaskInitial,
} from "@/components/dashboard/personal-task-form-dialog";
import { toggleTaskDone, deletePersonalTask } from "@/lib/actions/personal-tasks";

type LinkOption = { id: string; label: string };

export type PersonalTaskRow = PersonalTaskInitial & { done: boolean };

export function PersonalTaskCard({
  tasks,
  positions,
  applications,
}: {
  tasks: PersonalTaskRow[];
  positions: LinkOption[];
  applications: LinkOption[];
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const pending = tasks
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  const done = tasks.filter((t) => t.done);

  async function handleToggle(id: string, next: boolean) {
    setBusy(id);
    try {
      await toggleTaskDone(id, next);
    } catch {
      toast.error("操作失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePersonalTask(id);
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>我的日程</CardTitle>
        <PersonalTaskFormDialog
          positions={positions}
          applications={applications}
          trigger={
            <Button size="sm" variant="outline">
              <Plus />
              添加
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            自己写点安排，比如&ldquo;周五前联系内推人&rdquo;&ldquo;复习 XX 准备二面&rdquo;，可以关联到具体的岗位或投递记录
          </p>
        ) : (
          <>
            {pending.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                positions={positions}
                applications={applications}
                busy={busy === t.id}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
            {done.length > 0 && (
              <details className="pt-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  已完成（{done.length}）
                </summary>
                <div className="mt-2 space-y-2">
                  {done.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      positions={positions}
                      applications={applications}
                      busy={busy === t.id}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  positions,
  applications,
  busy,
  onToggle,
  onDelete,
}: {
  task: PersonalTaskRow;
  positions: LinkOption[];
  applications: LinkOption[];
  busy: boolean;
  onToggle: (id: string, next: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const linked =
    positions.find((p) => p.id === task.positionId) ??
    applications.find((a) => a.id === task.applicationId);

  return (
    <div className="flex items-start gap-2 rounded-md border p-2 text-sm">
      <Checkbox
        className="mt-0.5"
        checked={task.done}
        disabled={busy}
        onCheckedChange={(checked) => onToggle(task.id, checked === true)}
        aria-label={`标记 ${task.title} 完成`}
      />
      <div className="min-w-0 flex-1">
        <p className={task.done ? "truncate text-muted-foreground line-through" : "truncate font-medium"}>
          {task.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            task.dueDate && new Date(task.dueDate).toLocaleDateString(),
            linked?.label,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {task.note && <p className="mt-1 text-xs">{task.note}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        <PersonalTaskFormDialog
          positions={positions}
          applications={applications}
          initial={task}
          trigger={
            <Button size="sm" variant="ghost">
              编辑
            </Button>
          }
        />
        <ConfirmDeleteButton
          trigger={
            <Button size="sm" variant="ghost">
              删除
            </Button>
          }
          title={`确定删除「${task.title}」吗？`}
          onConfirm={() => onDelete(task.id)}
        />
      </div>
    </div>
  );
}
