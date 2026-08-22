"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MarkAppliedDialog } from "@/components/pool/mark-applied-dialog";
import {
  MatchResumeDialog,
  MatchResumeTrigger,
} from "@/components/pool/match-resume-dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deletePosition } from "@/lib/actions/positions";
import { POSITION_STATUS_LABELS } from "@/lib/stage-labels";
import { daysUntil } from "@/lib/reminders";
import { PositionFormDialog } from "@/components/pool/position-form-dialog";
import {
  InterviewPrepDialog,
  InterviewPrepTrigger,
} from "@/components/pool/interview-prep-dialog";
import type { PositionStatus } from "@prisma/client";
import type { InterviewPrep } from "@/lib/validation";

export type PoolPosition = {
  id: string;
  title: string;
  track: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  interestScore: number | null;
  deadline: string | null;
  status: PositionStatus;
  jdUrl: string | null;
  jdText: string | null;
  source: string | null;
  scoreBreakdown: unknown;
  interviewPrep: InterviewPrep | null;
  company: { name: string };
};

type ResumeOption = { id: string; name: string };

/** Tiered so a strong match stands out when skimming a long pool. */
function scoreVariant(score: number): "default" | "secondary" | "outline" {
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "outline";
}

function toEditInitial(p: PoolPosition) {
  return {
    companyName: p.company.name,
    title: p.title,
    track: p.track,
    location: p.location,
    salaryMin: p.salaryMin,
    salaryMax: p.salaryMax,
    jdUrl: p.jdUrl,
    jdText: p.jdText,
    source: p.source,
    deadline: p.deadline,
    scoreBreakdown: p.scoreBreakdown as {
      techFit?: number;
      salary?: number;
      location?: number;
      growth?: number;
    } | null,
  };
}

export function PoolTable({
  positions,
  resumeVersions,
  defaultResumeVersionId,
}: {
  positions: PoolPosition[];
  resumeVersions: ResumeOption[];
  defaultResumeVersionId?: string | null;
}) {
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [prepId, setPrepId] = useState<string | null>(null);
  const [batchMarking, setBatchMarking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () =>
      [...positions].sort(
        (a, b) => (b.interestScore ?? -1) - (a.interestScore ?? -1)
      ),
    [positions]
  );
  const markable = sorted.filter((p) => p.status !== "APPLIED");
  const marking = sorted.find((p) => p.id === markingId);
  const matching = sorted.find((p) => p.id === matchingId);
  const preparing = sorted.find((p) => p.id === prepId);
  const selectedPositions = sorted.filter((p) => selected.has(p.id));

  function toggleSelected(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(checked ? new Set(markable.map((p) => p.id)) : new Set());
  }

  async function handleDelete(id: string) {
    try {
      await deletePosition(id);
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>已选 {selected.size} 项</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setBatchMarking(true)}>
              批量标记已投
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
          </div>
        </div>
      )}

      {/* Mobile: cards. A 9-column table is unreadable under ~400px. */}
      <div className="space-y-3 md:hidden">
        {sorted.map((p) => {
          const deadline = p.deadline ? new Date(p.deadline) : null;
          const daysLeft = deadline ? daysUntil(deadline) : null;
          return (
            <div key={p.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                {p.status !== "APPLIED" && (
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(p.id)}
                    onCheckedChange={(checked) =>
                      toggleSelected(p.id, checked === true)
                    }
                    aria-label={`选择 ${p.title}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.company.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.title}
                  </p>
                </div>
                {p.interestScore !== null && (
                  <Badge variant={scoreVariant(p.interestScore)}>
                    {p.interestScore}
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {p.track && <span>{p.track}</span>}
                {p.location && <span>{p.location}</span>}
                {(p.salaryMin || p.salaryMax) && (
                  <span>
                    {p.salaryMin ?? "?"}-{p.salaryMax ?? "?"}K
                  </span>
                )}
                {deadline && (
                  <span
                    className={
                      daysLeft !== null && daysLeft <= 5
                        ? "font-medium text-destructive"
                        : ""
                    }
                  >
                    {deadline.toLocaleDateString()} 截止
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Badge variant="outline">
                  {POSITION_STATUS_LABELS[p.status]}
                </Badge>
                <div className="flex flex-wrap justify-end gap-1">
                  <MatchResumeTrigger onClick={() => setMatchingId(p.id)} />
                  <InterviewPrepTrigger onClick={() => setPrepId(p.id)} />
                  {p.status !== "APPLIED" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMarkingId(p.id)}
                    >
                      标记已投
                    </Button>
                  )}
                  <PositionFormDialog
                    mode="edit"
                    positionId={p.id}
                    initial={toEditInitial(p)}
                    trigger={
                      <Button size="sm" variant="outline">
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
                    title={`确定删除 ${p.company.name} · ${p.title} 吗？`}
                    onConfirm={() => handleDelete(p.id)}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center text-muted-foreground">
            <ListChecks className="size-8 text-muted-foreground/50" />
            <span className="text-sm">候选池为空，先添加一个感兴趣的岗位吧</span>
          </div>
        )}
      </div>

      <Table className="hidden md:table">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                checked={markable.length > 0 && selected.size === markable.length}
                onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                disabled={markable.length === 0}
                aria-label="全选"
              />
            </TableHead>
            <TableHead>公司 / 岗位</TableHead>
            <TableHead>方向</TableHead>
            <TableHead>地点</TableHead>
            <TableHead>薪资</TableHead>
            <TableHead>综合得分</TableHead>
            <TableHead>截止日期</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => {
            const deadline = p.deadline ? new Date(p.deadline) : null;
            const daysLeft = deadline ? daysUntil(deadline) : null;
            return (
              <TableRow key={p.id}>
                <TableCell>
                  {p.status !== "APPLIED" && (
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={(checked) =>
                        toggleSelected(p.id, checked === true)
                      }
                      aria-label={`选择 ${p.title}`}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{p.company.name}</div>
                  <div className="text-sm text-muted-foreground">{p.title}</div>
                </TableCell>
                <TableCell>{p.track ?? "-"}</TableCell>
                <TableCell>{p.location ?? "-"}</TableCell>
                <TableCell>
                  {p.salaryMin || p.salaryMax
                    ? `${p.salaryMin ?? "?"}-${p.salaryMax ?? "?"}K`
                    : "-"}
                </TableCell>
                <TableCell>
                  {p.interestScore !== null ? (
                    <Badge variant={scoreVariant(p.interestScore)}>
                      {p.interestScore}
                    </Badge>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>
                  {deadline ? (
                    <span
                      className={
                        daysLeft !== null && daysLeft <= 5
                          ? "text-destructive font-medium"
                          : ""
                      }
                    >
                      {deadline.toLocaleDateString()}
                    </span>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {POSITION_STATUS_LABELS[p.status]}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <MatchResumeTrigger onClick={() => setMatchingId(p.id)} />
                  <InterviewPrepTrigger onClick={() => setPrepId(p.id)} />
                  {p.status !== "APPLIED" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMarkingId(p.id)}
                    >
                      标记已投
                    </Button>
                  )}
                  <PositionFormDialog
                    mode="edit"
                    positionId={p.id}
                    initial={toEditInitial(p)}
                    trigger={
                      <Button size="sm" variant="outline">
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
                    title={`确定删除 ${p.company.name} · ${p.title} 吗？`}
                    onConfirm={() => handleDelete(p.id)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <ListChecks className="size-8 text-muted-foreground/50" />
                  <span>候选池为空，先添加一个感兴趣的岗位吧</span>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {preparing && (
        <InterviewPrepDialog
          positionId={preparing.id}
          positionLabel={`${preparing.company.name} · ${preparing.title}`}
          resumeVersions={resumeVersions}
          defaultResumeVersionId={defaultResumeVersionId}
          initialResult={preparing.interviewPrep}
          open={!!prepId}
          onOpenChange={(open) => !open && setPrepId(null)}
        />
      )}

      {matching && (
        <MatchResumeDialog
          positionId={matching.id}
          positionLabel={`${matching.company.name} · ${matching.title}`}
          open={!!matchingId}
          onOpenChange={(open) => !open && setMatchingId(null)}
        />
      )}

      {marking && (
        <MarkAppliedDialog
          positionIds={[marking.id]}
          positionLabels={[`${marking.company.name} · ${marking.title}`]}
          resumeVersions={resumeVersions}
          defaultResumeVersionId={defaultResumeVersionId}
          open={!!markingId}
          onOpenChange={(open) => !open && setMarkingId(null)}
        />
      )}

      {batchMarking && selectedPositions.length > 0 && (
        <MarkAppliedDialog
          positionIds={selectedPositions.map((p) => p.id)}
          positionLabels={selectedPositions.map(
            (p) => `${p.company.name} · ${p.title}`
          )}
          resumeVersions={resumeVersions}
          defaultResumeVersionId={defaultResumeVersionId}
          open={batchMarking}
          onOpenChange={(open) => {
            setBatchMarking(open);
            if (!open) setSelected(new Set());
          }}
        />
      )}
    </>
  );
}
