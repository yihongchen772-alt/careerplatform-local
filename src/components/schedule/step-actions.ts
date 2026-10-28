"use client";

import { toast } from "sonner";
import { setEventCompleted, setStepCompleted } from "@/lib/actions/schedule";

/**
 * 「我已完成 / 我已面完」 with 撤销 in the toast — shared by the cards, the
 * 改进度 menu and a 投递's own page.
 */
export async function completeStep(rowId: string, refresh: () => void, label = "已标记完成，开始计算等结果的天数", onUndo?: () => void): Promise<boolean> {
  const result = await setStepCompleted(rowId, true);
  if (!result.ok) {
    toast.error(result.message);
    return false;
  }
  toast.success(label, {
    action: {
      label: "撤销",
      onClick: async () => {
        const undo = await setStepCompleted(rowId, false);
        if (!undo.ok) toast.error(undo.message);
        else onUndo?.();
        refresh();
      },
    },
  });
  refresh();
  return true;
}

/** 「已完成」 for a calendar item that is not a 投递 step (a mail invitation, your own event). */
export async function completeEvent(eventId: string, refresh: () => void, label = "已完成", onUndo?: () => void): Promise<boolean> {
  const result = await setEventCompleted(eventId, true);
  if (!result.ok) {
    toast.error(result.message);
    return false;
  }
  toast.success(label, {
    action: {
      label: "撤销",
      onClick: async () => {
        const undo = await setEventCompleted(eventId, false);
        if (!undo.ok) toast.error(undo.message);
        else onUndo?.();
        refresh();
      },
    },
  });
  refresh();
  return true;
}
