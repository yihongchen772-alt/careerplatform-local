"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/stage-labels";
import { addStageUpdate } from "@/lib/actions/applications";
import { StageDateDialog } from "@/components/applications/stage-date-dialog";
import { windowStatus } from "@/lib/todos";
import type { ApplicationStage } from "@prisma/client";

export type BoardApplication = {
  id: string;
  companyName: string;
  title: string;
  currentStage: ApplicationStage;
  appliedDate: string;
  currentStageDate: string;
  nextDeadline: string | null;
  nextDeadlineEnd: string | null;
};

/**
 * The live pipeline, one column per stage. A table sorted by date answers
 * "what did I apply to"; it does not answer "where am I stuck", which is the
 * question that actually matters mid-season — thirteen things sitting in
 * 简历筛选中 is visible at a glance here and invisible in a list.
 *
 * Terminal stages (rejected / accepted / declined) are folded into one
 * collapsed column: they're the majority of rows by the end of a season and
 * would otherwise push the active pipeline off-screen.
 */
const ACTIVE_STAGES: ApplicationStage[] = STAGE_ORDER.filter(
  (s) => !["REJECTED", "ACCEPTED", "DECLINED"].includes(s)
);

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function ApplicationsBoard({
  applications,
}: {
  applications: BoardApplication[];
}) {
  const [moving, setMoving] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ApplicationStage | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    app: BoardApplication;
    stage: ApplicationStage;
  } | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<ApplicationStage, BoardApplication[]>();
    for (const stage of STAGE_ORDER) map.set(stage, []);
    for (const app of applications) map.get(app.currentStage)?.push(app);
    return map;
  }, [applications]);

  const closed = applications.filter((a) =>
    ["REJECTED", "ACCEPTED", "DECLINED"].includes(a.currentStage)
  );

  async function advance(app: BoardApplication, stage: ApplicationStage) {
    setMoving(app.id);
    try {
      await addStageUpdate(app.id, { stage });
      toast.success(`${app.companyName} → ${STAGE_LABELS[stage]}`);
    } catch {
      toast.error("更新失败，请重试");
    } finally {
      setMoving(null);
    }
  }

  function handleDrop(stage: ApplicationStage) {
    setDropTarget(null);
    if (!draggingId) return;
    const app = applications.find((a) => a.id === draggingId);
    setDraggingId(null);
    if (!app || app.currentStage === stage) return;
    setPendingDrop({ app, stage });
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="flex gap-3 overflow-x-auto pb-2">
        {ACTIVE_STAGES.map((stage) => {
          const items = byStage.get(stage) ?? [];
          const next = ACTIVE_STAGES[ACTIVE_STAGES.indexOf(stage) + 1];
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(stage);
              }}
              onDragLeave={() => setDropTarget((cur) => (cur === stage ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(stage);
              }}
              className={`w-56 shrink-0 rounded-lg border bg-muted/30 transition-colors ${
                dropTarget === stage ? "border-primary bg-primary/5" : ""
              }`}
            >
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">{STAGE_LABELS[stage]}</span>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="space-y-2 p-2">
                {items.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                    {dropTarget === stage ? "松手移到这个阶段" : "空"}
                  </p>
                ) : (
                  items.map((app) => {
                    const stalled = daysSince(app.currentStageDate);
                    return (
                      <div
                        key={app.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          setDraggingId(app.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDropTarget(null);
                        }}
                        className={`cursor-grab rounded-md border bg-card p-2.5 active:cursor-grabbing ${
                          draggingId === app.id ? "opacity-40" : ""
                        }`}
                      >
                        <Link
                          href={`/applications/${app.id}`}
                          className="text-sm font-medium underline-offset-4 hover:underline"
                        >
                          {app.companyName}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {app.title}
                        </p>
                        <p
                          className={`mt-1 text-xs ${
                            // Two weeks with no movement is the point where
                            // it's worth a nudge rather than more waiting.
                            stalled >= 14 ? "text-destructive" : "text-muted-foreground"
                          }`}
                        >
                          停留 {stalled} 天
                        </p>
                        {app.nextDeadline && (
                          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                            {
                              windowStatus(
                                new Date(app.nextDeadline),
                                app.nextDeadlineEnd ? new Date(app.nextDeadlineEnd) : null
                              ).note
                            }
                          </p>
                        )}
                        {next && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="mt-1 h-6 w-full justify-start px-1 text-xs"
                            disabled={moving === app.id}
                            onClick={() => advance(app, next)}
                          >
                            {moving === app.id ? "更新中..." : `→ ${STAGE_LABELS[next]}`}
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
        </div>
        {/* Mobile only: on desktop the columns' own width makes "there's more"
            obvious, but on a narrow screen only ~2 columns fit and nothing
            else hints that 笔试/一面/Offer etc. are sitting off-screen. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden" />
      </div>

      {closed.length > 0 && (
        <div className="rounded-lg border">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm"
          >
            <span className="font-medium">已结束（{closed.length}）</span>
            <span className="text-xs text-muted-foreground">
              {showClosed ? "收起" : "展开"}
            </span>
          </button>
          {showClosed && (
            <div className="flex flex-wrap gap-2 border-t p-3">
              {closed.map((app) => (
                <Link
                  key={app.id}
                  href={`/applications/${app.id}`}
                  className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                >
                  {app.companyName} · {STAGE_LABELS[app.currentStage]}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {applications.length > 0 && closed.length === applications.length && (
        <p className="text-sm text-muted-foreground">
          所有投递都已结束，看板上没有在进行中的了。
        </p>
      )}

      {pendingDrop && (
        <StageDateDialog
          applicationId={pendingDrop.app.id}
          companyName={pendingDrop.app.companyName}
          stage={pendingDrop.stage}
          onOpenChange={(open) => {
            if (!open) setPendingDrop(null);
          }}
          onDone={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}
