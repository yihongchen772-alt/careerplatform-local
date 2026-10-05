"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, PencilLine } from "lucide-react";
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
import { STAGE_LABELS } from "@/lib/stage-labels";
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
  className,
}: {
  applicationId: string;
  companyName: string;
  currentStage: ApplicationStage;
  className?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function change(stage: ApplicationStage) {
    if (saving) return;
    setSaving(true);
    try {
      const { stageHistoryId } = await addStageUpdate(applicationId, { stage });
      toast.success(`${companyName} 已改为「${STAGE_LABELS[stage]}」`, {
        action: {
          label: "撤销",
          onClick: async () => {
            const res = await deleteStageHistory(stageHistoryId);
            if (!res.ok) toast.error(res.message);
            else router.refresh();
          },
        },
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
        <DropdownMenuItem onClick={() => router.push(`/applications/${applicationId}#add-stage`)}>
          <PencilLine className="size-4" />填写阶段名称、日期…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
