"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createPersonalTask, updatePersonalTask } from "@/lib/actions/personal-tasks";

type LinkOption = { id: string; label: string };

export type PersonalTaskInitial = {
  id: string;
  title: string;
  note: string | null;
  dueDate: string | null;
  dueDateEnd: string | null;
  positionId: string | null;
  applicationId: string | null;
};

const NONE = "__none__";

export function PersonalTaskFormDialog({
  positions,
  applications,
  initial,
  defaultDueDate,
  trigger,
}: {
  positions: LinkOption[];
  applications: LinkOption[];
  initial?: PersonalTaskInitial;
  /** Pre-fills the date on a *new* task (e.g. the day the user clicked on
   * the calendar) without turning this into an edit — `initial` is what
   * does that, and a click-to-add day has no existing task to edit. */
  defaultDueDate?: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [dueDate, setDueDate] = useState(
    initial?.dueDate?.slice(0, 10) ?? defaultDueDate ?? ""
  );
  const [dueDateEnd, setDueDateEnd] = useState(
    initial?.dueDateEnd?.slice(0, 10) ?? ""
  );
  // "关联到" is one dropdown covering both lists — a task is about one job
  // search item or it isn't, never both at once.
  const [linkValue, setLinkValue] = useState(
    initial?.positionId
      ? `position:${initial.positionId}`
      : initial?.applicationId
        ? `application:${initial.applicationId}`
        : NONE
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle(initial?.title ?? "");
      setNote(initial?.note ?? "");
      setDueDate(initial?.dueDate?.slice(0, 10) ?? defaultDueDate ?? "");
      setDueDateEnd(initial?.dueDateEnd?.slice(0, 10) ?? "");
      setLinkValue(
        initial?.positionId
          ? `position:${initial.positionId}`
          : initial?.applicationId
            ? `application:${initial.applicationId}`
            : NONE
      );
    }
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title) {
      toast.error("标题必填");
      return;
    }
    const [kind, linkId] = linkValue === NONE ? [null, null] : linkValue.split(":");
    setLoading(true);
    try {
      const payload = {
        title,
        note: note || undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        dueDateEnd: dueDate && dueDateEnd ? new Date(dueDateEnd) : undefined,
        positionId: kind === "position" ? linkId : undefined,
        applicationId: kind === "application" ? linkId : undefined,
      };
      if (initial) {
        await updatePersonalTask(initial.id, payload);
        toast.success("已保存");
      } else {
        await createPersonalTask(payload);
        toast.success("已添加");
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  const linkLabel =
    linkValue === NONE
      ? "不关联"
      : (positions.find((p) => `position:${p.id}` === linkValue) ??
          applications.find((a) => `application:${a.id}` === linkValue))?.label;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "编辑日程" : "添加日程"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">标题 *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="周五前联系内推人"
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">日期（可选）</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                if (!e.target.value) setDueDateEnd("");
              }}
            />
          </div>
          {dueDate && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                结束日期（可选——笔试/测评这类有开放窗口的，填这个）
              </Label>
              <Input
                type="date"
                min={dueDate}
                value={dueDateEnd}
                onChange={(e) => setDueDateEnd(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">关联到（可选）</Label>
            <Select value={linkValue} onValueChange={(v) => v && setLinkValue(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{() => linkLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>不关联</SelectItem>
                {applications.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>已投递</SelectLabel>
                      {applications.map((a) => (
                        <SelectItem key={a.id} value={`application:${a.id}`}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
                {positions.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>候选</SelectLabel>
                      {positions.map((p) => (
                        <SelectItem key={p.id} value={`position:${p.id}`}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">备注</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
