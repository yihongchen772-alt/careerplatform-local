"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, Send, Trash2, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { daysSince, isTerminalStage } from "@/lib/reminders";
import { downloadCsv, toCsv } from "@/lib/csv";
import { todayKey } from "@/lib/dates";
import { toast } from "sonner";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deleteApplication } from "@/lib/actions/applications";
import { bulkDeleteApplications, bulkUpdateStage, undoBulkStage } from "@/lib/actions/schedule";
import { applicationStageStyle } from "@/lib/application-stage-style";
import { QuickStageMenu } from "@/components/applications/quick-stage-menu";
import { Highlight } from "@/components/applications/highlight";
import { useStoredChoice } from "@/components/applications/use-stored-choice";
import { rememberListOrder } from "@/components/applications/list-order";
import { deleteLater } from "@/components/applications/pending-deletes";
import { ProgressLine } from "@/components/schedule/next-schedule";
import { compareCompanyNames, type ApplicationHits } from "@/lib/application-search";
import { absoluteWhen, isUpcoming, itemStartMs, type ScheduleItem, type StepView } from "@/lib/interview-schedule";
import { cn } from "@/lib/utils";
import type { ApplicationStage } from "@prisma/client";

export type ApplicationRow = {
  id: string;
  title: string;
  appliedDate: string;
  currentStage: ApplicationStage;
  currentStageLabel?: string | null;
  terminatedAtStage?: string | null;
  terminatedAtStageLabel?: string | null;
  currentStageDate: string;
  referrer: string | null;
  source: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** The step's time or deadline that matters now (see nextScheduleItem). */
  nextSchedule: ScheduleItem | null;
  /** 等结果 / 截止已过 / a round still to do, for the current step. */
  step: StepView | null;
  waiting: boolean;
  /** Verbatim wording from the company's portal, via 网申进度同步. */
  portalStatus?: string | null;
  portalSuggestedStage?: ApplicationStage | null;
  company: { name: string; aliases?: { alias: string }[] };
};

const SORTS = ["applied", "updated", "schedule", "company"] as const;
const SORT_LABELS: Record<(typeof SORTS)[number], string> = { applied: "最近投递", updated: "最近有进展", schedule: "最近的安排", company: "公司名 A→Z" };

const BULK_PROGRESS: ApplicationStage[] = ["SCREENING", "ASSESSMENT", "OA", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER"];
const BULK_OUTCOMES: { stage: ApplicationStage; label: string }[] = [
  { stage: "REJECTED", label: "未通过（企业）" },
  { stage: "WITHDRAWN", label: "主动撤回" },
  { stage: "CANCELLED", label: "岗位取消" },
];

/** Upcoming first (soonest on top), then past ones (latest first), then none. */
function scheduleRank(item: ScheduleItem | null, now: number): [number, number] {
  if (!item) return [2, 0];
  return isUpcoming(item, now, 3650) ? [0, itemStartMs(item)] : [1, -itemStartMs(item)];
}

export function ApplicationsTable({
  applications,
  hits,
  now,
  orderLabel = "",
}: {
  applications: ApplicationRow[];
  /** The search's matches, when the list shows search results. */
  hits?: Map<string, ApplicationHits> | null;
  now: number;
  orderLabel?: string;
}) {
  const router = useRouter();
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [sort, setSort] = useStoredChoice("careerplatform.applications.sort", SORTS, "applied");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Deleted in a batch, waiting out the 撤销 window.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    const list = (stageFilter === "ALL" ? [...applications] : applications.filter((a) => a.currentStage === stageFilter)).filter((a) => !hidden.has(a.id));
    // Arrives newest application first; the other orders are re-sorts.
    if (sort === "updated") list.sort((a, b) => b.currentStageDate.localeCompare(a.currentStageDate));
    if (sort === "company") list.sort((a, b) => compareCompanyNames(a.company.name, b.company.name) || b.appliedDate.localeCompare(a.appliedDate));
    if (sort === "schedule") {
      list.sort((a, b) => {
        const [ga, ka] = scheduleRank(a.nextSchedule, now);
        const [gb, kb] = scheduleRank(b.nextSchedule, now);
        return ga - gb || ka - kb || b.appliedDate.localeCompare(a.appliedDate);
      });
    }
    return list;
  }, [applications, stageFilter, sort, hidden, now]);

  // The order a 投递's page steps through: this list, as sorted here.
  const orderKey = filtered.map((app) => app.id).join(",");
  useEffect(() => {
    rememberListOrder({ ids: orderKey ? orderKey.split(",") : [], href: `${window.location.pathname}${window.location.search}`, label: orderLabel });
  }, [orderKey, orderLabel]);

  // Only rows still on screen stay selected (a search or filter can hide some).
  const visibleSelected = filtered.filter((app) => selected.has(app.id));
  const allSelected = filtered.length > 0 && visibleSelected.length === filtered.length;

  function toggle(id: string, on: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    try {
      await deleteApplication(id);
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  }

  async function bulkStage(stage: ApplicationStage) {
    const ids = visibleSelected.map((app) => app.id);
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await bulkUpdateStage(ids, stage);
      if (!result.ok) return void toast.error(result.message);
      const { created, skipped } = result.data;
      setSelected(new Set());
      router.refresh();
      if (!created.length) return void toast.info(`选中的投递本来就是「${STAGE_LABELS[stage]}」`);
      toast.success(`已把 ${created.length} 条投递改为「${STAGE_LABELS[stage]}」${skipped ? `（${skipped} 条本来就是）` : ""}`, {
        duration: 10000,
        action: {
          label: "撤销",
          onClick: async () => {
            const undo = await undoBulkStage(created);
            if (!undo.ok) toast.error(undo.message);
            else {
              toast.success("已撤销，这些投递回到之前的进度");
              router.refresh();
            }
          },
        },
      });
    } finally {
      setBulkBusy(false);
    }
  }

  function bulkDelete() {
    const ids = visibleSelected.map((app) => app.id);
    if (!ids.length) return;
    setHidden((previous) => new Set([...previous, ...ids]));
    setSelected(new Set());
    const undo = deleteLater(ids, async (committed) => {
      const result = await bulkDeleteApplications(committed);
      if (!result.ok) {
        toast.error(result.message);
        setHidden((previous) => new Set([...previous].filter((id) => !committed.includes(id))));
      }
      router.refresh();
    });
    toast.success(`已删除 ${ids.length} 条投递`, {
      duration: 8000,
      action: {
        label: "撤销",
        onClick: () => {
          if (undo()) {
            setHidden((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
            toast.success("已撤销删除");
          } else toast.error("已经删除了，来不及撤销");
        },
      },
    });
  }

  function handleExport() {
    const csv = toCsv(filtered, [
      { header: "公司", value: (a) => a.company.name },
      { header: "岗位", value: (a) => a.title },
      { header: "投递日期", value: (a) => new Date(a.appliedDate).toLocaleDateString("zh-CN") },
      { header: "当前状态", value: (a) => a.currentStageLabel ? `${STAGE_LABELS[a.currentStage]} · ${a.currentStageLabel}` : STAGE_LABELS[a.currentStage] },
      { header: "下一步", value: (a) => a.nextSchedule ? `${a.nextSchedule.title} ${absoluteWhen(a.nextSchedule.startsAt, a.nextSchedule.hasTime)}` : "" },
      { header: "会议信息", value: (a) => a.nextSchedule?.meetingInfo ?? "" },
      { header: "距上次更新(天)", value: (a) => daysSince(new Date(a.currentStageDate)) },
      { header: "渠道", value: (a) => a.source ?? "" },
      { header: "内推人", value: (a) => a.referrer ?? "" },
      { header: "薪资下限(K)", value: (a) => a.salaryMin ?? "" },
      { header: "薪资上限(K)", value: (a) => a.salaryMax ?? "" },
    ]);
    downloadCsv(`投递记录_${todayKey()}.csv`, csv);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">具体阶段</span>
          <Select
            value={stageFilter}
            onValueChange={(value) => setStageFilter(value ?? "ALL")}
          >
            <SelectTrigger className="w-40 rounded-xl sm:w-48">
              <SelectValue>
                {(value: string) =>
                  value === "ALL" ? "全部" : STAGE_LABELS[value as ApplicationStage]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部</SelectItem>
              {Object.entries(STAGE_LABELS).map(([stage, label]) => (
                <SelectItem key={stage} value={stage}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="shrink-0 text-xs font-medium text-muted-foreground sm:ml-2">排序</span>
          <Select value={sort} onValueChange={(value) => value && setSort(value as (typeof SORTS)[number])}>
            <SelectTrigger className="w-36 rounded-xl" aria-label="排序">
              <SelectValue>{(value: string) => SORT_LABELS[value as (typeof SORTS)[number]] ?? "最近投递"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((value) => (
                <SelectItem key={value} value={value}>{SORT_LABELS[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 self-start sm:self-auto"
          onClick={handleExport}
        >
          <Download />
          导出 CSV
        </Button>
      </div>

      {visibleSelected.length > 0 && (
        <div className="sticky top-2 z-20 hidden flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-xl md:flex" role="toolbar" aria-label="批量操作">
          <span className="text-sm font-medium">已选 {visibleSelected.length} 条</span>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" disabled={bulkBusy} className="gap-1" />}>
              {bulkBusy ? "修改中…" : "批量改进度"}
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>推进到</DropdownMenuLabel>
                {BULK_PROGRESS.map((stage) => <DropdownMenuItem key={stage} onClick={() => bulkStage(stage)}>{STAGE_LABELS[stage]}</DropdownMenuItem>)}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>结束流程</DropdownMenuLabel>
                {BULK_OUTCOMES.map((item) => <DropdownMenuItem key={item.stage} variant={item.stage === "REJECTED" ? "destructive" : "default"} onClick={() => bulkStage(item.stage)}>{item.label}</DropdownMenuItem>)}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ConfirmDeleteButton
            trigger={<Button type="button" size="sm" variant="ghost" className="gap-1 text-destructive"><Trash2 className="size-3.5" />删除</Button>}
            title={`删除选中的 ${visibleSelected.length} 条投递？`}
            description="进展记录、附件和面试安排会一并删除。删除后几秒内可以在提示里撤销。"
            onConfirm={bulkDelete}
          />
          <Button type="button" size="sm" variant="ghost" className="ml-auto gap-1" onClick={() => setSelected(new Set())}><X className="size-3.5" />取消选择</Button>
        </div>
      )}

      {/* Mobile: cards. The 6-column table is unreadable under ~400px. */}
      <div className="space-y-3 md:hidden">
        {filtered.map((app) => {
          const stale = daysSince(new Date(app.currentStageDate));
          const terminal = isTerminalStage(app.currentStage);
          return (
            // Delete sits outside the Link: nesting a button inside an anchor is
            // invalid and the tap would race the navigation.
            <div key={app.id} className="rounded-2xl border border-border/70 bg-background/55 p-4 shadow-sm">
              <Link
                href={`/applications/${app.id}`}
                className="block space-y-2 transition-opacity hover:opacity-80"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-sm font-semibold text-primary">{app.company.name.slice(0, 1)}</span>
                    <div className="min-w-0">
                    <p className="truncate text-sm font-semibold"><Highlight text={app.company.name} ranges={hits?.get(app.id)?.company} />{hits?.get(app.id)?.alias && <span className="ml-1 text-xs font-normal text-muted-foreground">（{hits.get(app.id)!.alias}）</span>}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <Highlight text={app.title} ranges={hits?.get(app.id)?.title} />
                    </p>
                    </div>
                  </div>
                  <Badge className={cn("h-6 border-0 px-2.5", applicationStageStyle(app.currentStage).pill)}>
                    {STAGE_LABELS[app.currentStage]}
                  </Badge>
                </div>
                {app.currentStageLabel && <p className="text-xs font-medium">{app.currentStageLabel}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/55 pt-3 text-xs text-muted-foreground">
                  <span>{new Date(app.appliedDate).toLocaleDateString("zh-CN")} 投递</span>
                  <span
                    className={
                      !terminal && stale >= 14 ? "font-medium text-destructive" : ""
                    }
                  >
                    {stale} 天未更新
                  </span>
                  {app.source && <span>{app.source}</span>}
                  {app.referrer && <span>内推：{app.referrer}</span>}
                </div>
              </Link>
              {!terminal && <ProgressLine applicationId={app.id} step={app.step} next={app.nextSchedule} now={now} className="mt-2" />}
              <div className="mt-1 flex items-center justify-end gap-1">
                <QuickStageMenu applicationId={app.id} companyName={app.company.name} currentStage={app.currentStage} step={app.step} />
                <ConfirmDeleteButton
                  trigger={
                    <Button size="sm" variant="ghost">
                      删除
                    </Button>
                  }
                  title={`确定删除 ${app.company.name} · ${app.title} 吗？`}
                  description="这条投递的进展记录和附件也会一并删除，无法撤销。"
                  onConfirm={() => handleDelete(app.id)}
                />
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center text-muted-foreground">
            <Send className="size-8 text-muted-foreground/50" />
            <span className="text-sm">暂无投递记录</span>
          </div>
        )}
      </div>

      <Table className="hidden md:table">
        <TableHeader>
          <TableRow className="border-border/55 hover:bg-transparent">
            <TableHead className="w-8 pr-0">
              <Checkbox
                aria-label={allSelected ? "取消全选" : "全选当前列表"}
                checked={allSelected}
                indeterminate={visibleSelected.length > 0 && !allSelected}
                onCheckedChange={(checked) => setSelected(checked ? new Set(filtered.map((app) => app.id)) : new Set())}
              />
            </TableHead>
            <TableHead>公司 / 岗位</TableHead>
            <TableHead>当前状态</TableHead>
            <TableHead>下一步</TableHead>
            <TableHead>投递日期</TableHead>
            <TableHead>距上次更新</TableHead>
            <TableHead>渠道</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((app) => {
            const stale = daysSince(new Date(app.currentStageDate));
            const terminal = isTerminalStage(app.currentStage);
            const checked = selected.has(app.id);
            return (
              <TableRow key={app.id} data-state={checked ? "selected" : undefined} className={cn("border-border/45 transition-colors hover:bg-primary/[0.035]", checked && "bg-primary/[0.05]")}>
                <TableCell className="w-8 pr-0">
                  <Checkbox aria-label={`选择 ${app.company.name} · ${app.title}`} checked={checked} onCheckedChange={(value) => toggle(app.id, value === true)} />
                </TableCell>
                <TableCell>
                  <Link href={`/applications/${app.id}`} className="flex min-w-0 items-center gap-3 py-1.5 hover:text-primary">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-sm font-semibold text-primary">{app.company.name.slice(0, 1)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold"><Highlight text={app.company.name} ranges={hits?.get(app.id)?.company} />{hits?.get(app.id)?.alias && <span className="ml-1 text-xs font-normal text-muted-foreground">（{hits.get(app.id)!.alias}）</span>}</span>
                      <span className="block truncate text-xs text-muted-foreground"><Highlight text={app.title} ranges={hits?.get(app.id)?.title} /></span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge className={cn("h-6 border-0 px-2.5", applicationStageStyle(app.currentStage).pill)}>
                    {STAGE_LABELS[app.currentStage]}
                  </Badge>
                  {app.currentStageLabel && <p className="mt-1 max-w-48 truncate text-xs text-muted-foreground" title={app.currentStageLabel}>{app.currentStageLabel}</p>}
                </TableCell>
                <TableCell className="max-w-72">
                  {!terminal && (app.nextSchedule || (app.step && app.step.phase !== "open")) ? <ProgressLine applicationId={app.id} step={app.step} next={app.nextSchedule} now={now} /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {new Date(app.appliedDate).toLocaleDateString("zh-CN")}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      !terminal && stale >= 14 ? "text-destructive font-medium" : ""
                    }
                  >
                    {stale} 天
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{app.source ?? "—"}{app.referrer ? <span className="block text-xs">内推：{app.referrer}</span> : null}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                  <QuickStageMenu applicationId={app.id} companyName={app.company.name} currentStage={app.currentStage} step={app.step} />
                  <ConfirmDeleteButton
                    trigger={
                      <Button size="sm" variant="ghost">
                        删除
                      </Button>
                    }
                    title={`确定删除 ${app.company.name} · ${app.title} 吗？`}
                    description="这条投递的进展记录和附件也会一并删除，无法撤销。"
                    onConfirm={() => handleDelete(app.id)}
                  />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Send className="size-8 text-muted-foreground/50" />
                  <span>暂无投递记录</span>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
