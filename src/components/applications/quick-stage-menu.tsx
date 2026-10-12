"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, ChevronDown, PencilLine, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addStageUpdate, deleteStageHistory } from "@/lib/actions/applications";
import { setStepCompleted } from "@/lib/actions/schedule";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { SCHEDULE_STAGES, scheduleKindOf, type StepView } from "@/lib/interview-schedule";
import { completeStep } from "@/components/schedule/step-actions";
import { cn } from "@/lib/utils";

const PROGRESS: ApplicationStage[] = ["SCREENING", "ASSESSMENT", "OA", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER"];
const OUTCOMES: { stage: ApplicationStage; label: string }[] = [
  { stage: "REJECTED", label: "未通过（企业）" },
  { stage: "ACCEPTED", label: "已接受 Offer" },
  { stage: "DECLINED", label: "已拒绝 Offer（本人）" },
  { stage: "WITHDRAWN", label: "主动撤回" },
  { stage: "CANCELLED", label: "岗位取消" },
];

/**
 * One click to the next stage from the board or list, without opening the
 * application and filling the full form. Details (stage name, notes,
 * deadlines) stay optional and are one more click away.
 */
export function QuickStageMenu({
  applicationId,
  companyName,
  currentStage,
  step = null,
  className,
}: {
  applicationId: string;
  companyName: string;
  currentStage: ApplicationStage;
  /** The current round, for 「本轮已完成」. */
  step?: StepView | null;
  className?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function change(stage: ApplicationStage) {
    if (saving) return;
    setSaving(true);
    try {
      const { stageHistoryId } = await addStageUpdate(applicationId, { stage });
      // A round usually comes with a time: one click to add it.
      const bookable = SCHEDULE_STAGES.includes(stage);
      toast.success(`${companyName} 已改为「${STAGE_LABELS[stage]}」`, {
        ...(bookable ? { description: "收到时间了？点「加时间」记上，到点提醒你", duration: 8000 } : {}),
        action: {
          label: "撤销",
          onClick: async () => {
            const res = await deleteStageHistory(stageHistoryId);
            if (!res.ok) toast.error(res.message);
            else router.refresh();
          },
        },
        ...(bookable ? { cancel: { label: "加时间", onClick: () => router.push(`/applications/${applicationId}?addTime=1#interview`) } } : {}),
      });
      router.refresh();
    } catch {
      toast.error("更新失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" size="sm" variant="outline" disabled={saving} className={cn("h-7 gap-1 rounded-full px-2.5 text-xs", className)} aria-label={`修改 ${companyName} 的进度`} />}
      >
        {saving ? "保存中…" : "改进度"}
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {step && step.phase !== "waiting" && (
          <>
            <DropdownMenuItem onClick={() => { void completeStep(step.rowId, () => router.refresh(), `${companyName} · ${STAGE_LABELS[step.stage]}已完成，开始等结果`); }}>
              <CheckCircle2 className="size-4" />{scheduleKindOf(step.stage) === "interview" ? "这轮已面完" : "这轮已完成"}（等结果）
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {step?.completed && (
          <>
            <DropdownMenuItem onClick={async () => { const res = await setStepCompleted(step.rowId, false); if (!res.ok) toast.error(res.message); else router.refresh(); }}>
              <Undo2 className="size-4" />取消「已完成」
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>推进到</DropdownMenuLabel>
          {PROGRESS.filter((stage) => stage !== currentStage).map((stage) => (
            <DropdownMenuItem key={stage} onClick={() => change(stage)}>{STAGE_LABELS[stage]}</DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>结束流程</DropdownMenuLabel>
          {OUTCOMES.filter((item) => item.stage !== currentStage && (currentStage === "OFFER" || (item.stage !== "ACCEPTED" && item.stage !== "DECLINED"))).map((item) => (
            <DropdownMenuItem key={item.stage} variant={item.stage === "REJECTED" ? "destructive" : "default"} onClick={() => change(item.stage)}>{item.label}</DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {!["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"].includes(currentStage) && (
          <DropdownMenuItem onClick={() => router.push(`/applications/${applicationId}?addTime=1#interview`)}>
            <CalendarPlus className="size-4" />添加面试 / 笔试时间
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => router.push(`/applications/${applicationId}#add-stage`)}>
          <PencilLine className="size-4" />填写阶段名称、日期…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
