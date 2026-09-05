"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addStageUpdate } from "@/lib/actions/applications";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { todayKey } from "@/lib/dates";
import type { ApplicationStage } from "@prisma/client";

/**
 * Confirms the date for a drag-triggered stage move. Deliberately just a
 * date — dragging a card is the fast path precisely because the full
 * "添加进展更新" form (note/interview format/interviewer/deadline) is more
 * than most moves need; that form stays available on the detail page for
 * when those details matter.
 */
export function StageDateDialog({
  applicationId,
  companyName,
  stage,
  onOpenChange,
  onDone,
}: {
  applicationId: string;
  companyName: string;
  stage: ApplicationStage;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(todayKey);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await addStageUpdate(applicationId, { stage, enteredAt: new Date(date) });
      toast.success(`${companyName} → ${STAGE_LABELS[stage]}`);
      onDone();
    } catch {
      toast.error("更新失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {companyName} → {STAGE_LABELS[stage]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">进入这个阶段的时间</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" disabled={loading} onClick={handleConfirm}>
            {loading ? "保存中..." : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
