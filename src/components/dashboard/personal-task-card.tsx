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
import { toggleTaskDone, deletePersonalTask, cleanupDuplicateImportedTasks } from "@/lib/actions/personal-tasks";

type LinkOption = { id: string; label: string };

export type PersonalTaskRow = PersonalTaskInitial & { done: boolean };

export function PersonalTaskCard({
  tasks,
  positions,
  applications,
  duplicateMailTaskCount,
}: {
  tasks: PersonalTaskRow[];
  positions: LinkOption[];
  applications: LinkOption[];
  duplicateMailTaskCount: number;
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
    <Card className="rounded-[1.5rem] border-border/65 bg-card/75 shadow-[0_16px_45px_-38px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      <CardHeader className="flex-col items-start justify-between gap-2 space-y-0 sm:flex-row sm:items-center">
        <CardTitle>我的日程</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {duplicateMailTaskCount > 0 && <ConfirmDeleteButton
            trigger={<Button size="sm" variant="ghost">清理重复邮件（{duplicateMailTaskCount}）</Button>}
            title={`清理 ${duplicateMailTaskCount} 条重复邮件日程？`}
            description="只删除内容完全相同、未完成且没有日期或岗位关联的旧邮件导入项；其他日程不会删除。"
            onConfirm={async () => {
              try {
                const count = await cleanupDuplicateImportedTasks();
                toast.success(count > 0 ? `已清理 ${count} 条重复日程` : "没有可清理的重复日程");
              } catch {
                toast.error("清理失败，请重试");
              }
            }}
          />}
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
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-5">
            <p className="text-sm font-medium">给自己留一项具体安排</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">例如联系内推人、准备二面，也可以关联到对应岗位。</p>
          </div>
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
            task.dueDate &&
              (task.dueDateEnd
                ? `${new Date(task.dueDate).toLocaleDateString("zh-CN")} - ${new Date(task.dueDateEnd).toLocaleDateString("zh-CN")}`
                : new Date(task.dueDate).toLocaleDateString("zh-CN")),
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
