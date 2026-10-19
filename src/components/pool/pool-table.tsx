"use client";

import { useMemo, useState } from "react";
import { useStoredChoice } from "@/components/applications/use-stored-choice";
import { askXiaoOu } from "@/components/dashboard/agent-brief-card";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ClipboardCheck, Crosshair, FileText, Globe, ListChecks, Pencil, Sparkles, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkAppliedDialog } from "@/components/pool/mark-applied-dialog";
import {
  MatchResumeDialog,
  MatchResumeTrigger,
} from "@/components/pool/match-resume-dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deletePosition } from "@/lib/actions/positions";
import { POSITION_STATUS_LABELS } from "@/lib/stage-labels";
import { daysUntil } from "@/lib/reminders";
import { ApplicationRulesDialog } from "@/components/pool/application-rules-dialog";
import { PositionFormDialog } from "@/components/pool/position-form-dialog";
import {
  CompanyInsightDialog,
  CompanyInsightTrigger,
} from "@/components/pool/company-insight-dialog";
import {
  InterviewPrepDialog,
  InterviewPrepTrigger,
} from "@/components/pool/interview-prep-dialog";
import {
  CoverLetterDialog,
  CoverLetterTrigger,
} from "@/components/pool/cover-letter-dialog";
import type { PositionStatus } from "@prisma/client";
import type { InterviewPrep, GroupInterviewPrep } from "@/lib/validation";
import type { ConversionRow } from "@/lib/analytics";
import { computeOpportunityScore, TIER_META, type OpportunityScore } from "@/lib/opportunity-score";

export type PoolPosition = {
  id: string;
  title: string;
  track: string | null;
  department: string | null;
  recruitmentType?: string | null;
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
  groupInterviewPrep: GroupInterviewPrep | null;
  /** Best PositionMatch across every resume version checked against this
   * position (src/lib/actions/resume-match.ts) — null until "选简历" has
   * been run at least once. Distinct from interestScore: that's a manual
   * self-rating, this is the AI's JD-vs-resume judgement. */
  bestMatch: { score: number; recommendation: string } | null;
  coverLetter: string | null;
  company: { name: string };
};

type ResumeOption = { id: string; name: string };

const ALL = "__all__";
type SortKey = "score" | "deadline" | "added" | "priority";

function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) {
  if (options.length === 0) return null;
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="w-36">
        <SelectValue>{() => (value === ALL ? allLabel : value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tiered so a strong match stands out when skimming a long pool. */
function scoreVariant(score: number): "default" | "secondary" | "outline" {
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "outline";
}

/**
 * Pure recombination of signals that already exist elsewhere (JD text,
 * PositionMatch, CoverLetter, InterviewPrep) into one glance — "are you
 * actually ready to hit submit on this one" isn't answerable by any single
 * existing column, especially right before a deadline.
 */
function readinessItems(p: PoolPosition): { label: string; done: boolean }[] {
  return [
    { label: "JD", done: !!p.jdText },
    { label: "AI 匹配", done: !!p.bestMatch },
    { label: "自荐信", done: !!p.coverLetter },
    { label: "面试攻略", done: !!p.interviewPrep },
  ];
}

/** `compact` (the table): the badge alone, what is missing on hover. */
function ReadinessBadge({ items, compact = false }: { items: { label: string; done: boolean }[]; compact?: boolean }) {
  const doneCount = items.filter((i) => i.done).length;
  const missing = items.filter((i) => !i.done).map((i) => i.label);
  const variant = doneCount === items.length ? "default" : doneCount === 0 ? "outline" : "secondary";
  return (
    <div className="space-y-0.5" title={missing.length ? `还缺：${missing.join("、")}` : undefined}>
      <Badge variant={variant}>
        {doneCount}/{items.length} 就绪
      </Badge>
      {!compact && missing.length > 0 && (
        <p className="text-xs text-muted-foreground">缺：{missing.join("、")}</p>
      )}
    </div>
  );
}

/**
 * Combines match score × historical same-track success rate × deadline
 * urgency × how much prep is already done into one priority tier — see
 * src/lib/opportunity-score.ts for why this is arithmetic on real numbers
 * rather than another AI call.
 */
function getOpportunity(
  p: PoolPosition,
  historyByTrack: Record<string, ConversionRow>
): OpportunityScore {
  const readiness = readinessItems(p);
  return computeOpportunityScore(
    {
      matchScore: p.bestMatch?.score ?? null,
      track: p.track,
      deadline: p.deadline ? new Date(p.deadline) : null,
      readinessCount: readiness.filter((i) => i.done).length,
      readinessTotal: readiness.length,
    },
    new Map(Object.entries(historyByTrack))
  );
}

function OpportunityBadge({ opportunity }: { opportunity: OpportunityScore }) {
  const meta = TIER_META[opportunity.tier];
  return (
    <Badge variant="outline" title={opportunity.reasons.join("；")}>
      {meta.emoji} {meta.label}
    </Badge>
  );
}

function toEditInitial(p: PoolPosition) {
  return {
    companyName: p.company.name,
    title: p.title,
    track: p.track,
    department: p.department,
    recruitmentType: p.recruitmentType,
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

const POOL_SCOPES = ["todo", "applied", "all"] as const;

export function PoolTable({
  positions,
  resumeVersions,
  defaultResumeVersionId,
  historyByTrack,
  openPrepFor = null,
}: {
  positions: PoolPosition[];
  resumeVersions: ResumeOption[];
  defaultResumeVersionId?: string | null;
  historyByTrack: Record<string, ConversionRow>;
  /** A position whose 面试攻略 opens straight away (a 投递's 「岗位 JD / 面试攻略」). */
  openPrepFor?: string | null;
}) {
  const router = useRouter();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [prepId, setPrepId] = useState<string | null>(() => (openPrepFor && positions.some((p) => p.id === openPrepFor) ? openPrepFor : null));
  const [letterId, setLetterId] = useState<string | null>(null);
  const [insightId, setInsightId] = useState<string | null>(null);
  const [batchMarking, setBatchMarking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [city, setCity] = useState(ALL);
  const [track, setTrack] = useState(ALL);
  const [sort, setSort] = useState<SortKey>("score");
  // 候选池 is for what is still to apply to; applied ones are one click away.
  const [scope, setScope] = useStoredChoice("careerplatform.pool.scope", POOL_SCOPES, "todo");
  const todoCount = positions.filter((p) => p.status !== "APPLIED").length;
  const appliedCount = positions.length - todoCount;

  const cities = useMemo(
    () => [...new Set(positions.map((p) => p.location).filter(Boolean))].sort() as string[],
    [positions]
  );
  const tracks = useMemo(
    () => [...new Set(positions.map((p) => p.track).filter(Boolean))].sort() as string[],
    [positions]
  );

  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = positions.filter((p) => {
      if (scope === "todo" && p.status === "APPLIED") return false;
      if (scope === "applied" && p.status !== "APPLIED") return false;
      if (city !== ALL && p.location !== city) return false;
      if (track !== ALL && p.track !== track) return false;
      if (!needle) return true;
      return [p.company.name, p.title, p.department, p.location]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(needle));
    });

    return [...filtered].sort((a, b) => {
      if (sort === "score") return (b.interestScore ?? -1) - (a.interestScore ?? -1);
      if (sort === "priority") {
        return getOpportunity(b, historyByTrack).score - getOpportunity(a, historyByTrack).score;
      }
      if (sort === "deadline") {
        // Undated positions sort last rather than jumping to the front as 0.
        const av = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const bv = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        return av - bv;
      }
      return 0;
    });
  }, [positions, q, city, track, sort, historyByTrack, scope]);
  // A column of dashes says nothing; only shown once some position has a salary.
  const anySalary = sorted.some((p) => p.salaryMin || p.salaryMax);
  const markable = sorted.filter((p) => p.status !== "APPLIED");
  // Looked up from the full unfiltered list, not `sorted` — a dialog opened
  // for a position must keep working even if the search/filter above it
  // changes underneath while it's open.
  const marking = positions.find((p) => p.id === markingId);
  const matching = positions.find((p) => p.id === matchingId);
  const preparing = positions.find((p) => p.id === prepId);
  const drafting = positions.find((p) => p.id === letterId);
  const inspecting = positions.find((p) => p.id === insightId);
  const selectedPositions = positions.filter((p) => selected.has(p.id));

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
      {positions.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 gap-1 rounded-full border border-border/70 bg-card/75 p-1" role="group" aria-label="看哪些岗位">
            {([["todo", "还没投", todoCount], ["applied", "已投递", appliedCount], ["all", "全部", positions.length]] as const).map(([id, label, count]) => (
              <button key={id} type="button" aria-pressed={scope === id} onClick={() => { setScope(id); setSelected(new Set()); }} className={cn("h-7 rounded-full px-3 text-xs font-medium transition-colors", scope === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label} {count}</button>
            ))}
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜公司 / 岗位 / 部门"
            className="w-full sm:w-64"
          />
          <FilterSelect value={city} onChange={setCity} options={cities} allLabel="全部城市" />
          <FilterSelect value={track} onChange={setTrack} options={tracks} allLabel="全部方向" />
          <Select value={sort} onValueChange={(v) => v && setSort(v as SortKey)}>
            <SelectTrigger className="w-36">
              <SelectValue>
                {() =>
                  sort === "score"
                    ? "按综合得分"
                    : sort === "priority"
                      ? "按优先级"
                      : sort === "deadline"
                        ? "按截止日期"
                        : "按加入顺序"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">按优先级</SelectItem>
              <SelectItem value="score">按综合得分</SelectItem>
              <SelectItem value="deadline">按截止日期</SelectItem>
              <SelectItem value="added">按加入顺序</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">共 {sorted.length} 条</span>
        </div>
      )}

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
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p.interestScore !== null && (
                    <Badge variant={scoreVariant(p.interestScore)}>
                      {p.interestScore}
                    </Badge>
                  )}
                  {p.bestMatch && (
                    <Badge
                      variant={scoreVariant(p.bestMatch.score)}
                      title={p.bestMatch.recommendation}
                    >
                      AI {p.bestMatch.score}
                    </Badge>
                  )}
                  <ReadinessBadge items={readinessItems(p)} />
                  <OpportunityBadge opportunity={getOpportunity(p, historyByTrack)} />
                </div>
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {p.track && <span>{p.track}</span>}
                {p.department && <span>{p.department}</span>}
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
                    {deadline.toLocaleDateString("zh-CN")} 截止
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
                  <CoverLetterTrigger onClick={() => setLetterId(p.id)} />
                  <CompanyInsightTrigger onClick={() => setInsightId(p.id)} />
                  {p.status !== "APPLIED" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMarkingId(p.id)}
                    >
                      标记已投
                    </Button>
                  )}
                  {p.jdUrl && (
                    <Link
                      href={`/browser?url=${encodeURIComponent(p.jdUrl)}&positionId=${p.id}`}
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                    >
                      <Globe className="size-3.5" />
                      打开网申页面
                    </Link>
                  )}
                  <Link
                    href={`/resume-drill?position=${p.id}`}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    title="针对这个岗位的 JD，让 AI 按你的简历生成三层追问来练"
                  >
                    <Crosshair className="size-3.5" />
                    简历深挖
                  </Link>
                  <Link
                    href={`/resumes/tailored?positionId=${p.id}`}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    title="用 AI 为这个岗位整理一份定制简历，可编辑后导出 PDF / Word"
                  >
                    <FileText className="size-3.5" />
                    定制简历
                  </Link>
                  <ApplicationRulesDialog positionId={p.id} />
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
            <span className="text-sm">
              {positions.length === 0
                ? "候选池为空，先添加一个感兴趣的岗位吧"
                : scope === "todo" && todoCount === 0
                  ? <>还没投的岗位都在这里。现在 {appliedCount} 个都投过了——<Link href="/leads" className="text-primary underline">去秋招信息库挑</Link>，或者<button type="button" className="text-primary underline" onClick={() => askXiaoOu("按我的方向和意向城市，去官网找几个新岗位")}>让小欧找几个新岗位</button>。</>
                  : "当前筛选条件下没有岗位"}
            </span>
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
            <TableHead>方向 · 地点</TableHead>
            {anySalary && <TableHead>薪资</TableHead>}
            <TableHead>得分</TableHead>
            <TableHead>投递就绪</TableHead>
            <TableHead>优先级</TableHead>
            <TableHead>截止日期</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="sticky right-0 z-10 bg-card text-right">操作</TableHead>
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
                <TableCell className="max-w-[16rem] whitespace-normal">
                  <div className="font-medium">{p.company.name}</div>
                  <div className="line-clamp-2 text-sm text-muted-foreground" title={p.title}>{p.title}</div>
                </TableCell>
                <TableCell className="max-w-[10rem] whitespace-normal">
                  <div className="truncate" title={p.track ?? undefined}>{p.track ?? "-"}</div>
                  <div className="truncate text-xs text-muted-foreground" title={p.location ?? undefined}>{p.location ?? ""}</div>
                </TableCell>
                {anySalary && (
                  <TableCell>
                  {p.salaryMin || p.salaryMax
                    ? `${p.salaryMin ?? "?"}-${p.salaryMax ?? "?"}K`
                    : "-"}
                  </TableCell>
                )}
                <TableCell>
                  {/* 综合得分 with the AI 匹配 under it. */}
                  <div className="flex flex-col items-start gap-0.5">
                    {p.interestScore !== null ? <Badge variant={scoreVariant(p.interestScore)} title="综合得分">{p.interestScore}</Badge> : <span>-</span>}
                    {p.bestMatch ? (
                      <span className="text-xs text-muted-foreground" title={p.bestMatch.recommendation}>AI {p.bestMatch.score} · {p.bestMatch.recommendation}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">未匹配</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <ReadinessBadge items={readinessItems(p)} compact />
                </TableCell>
                <TableCell>
                  <OpportunityBadge opportunity={getOpportunity(p, historyByTrack)} />
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
                      {deadline.toLocaleDateString("zh-CN")}
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
                <TableCell className="sticky right-0 z-10 bg-card text-right shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.25)]">
                  {/* One main action, the AI tools in a menu, the rest as icons:
                      nine buttons in a row made this table 3x the window wide. */}
                  <div className="flex items-center justify-end gap-1">
                    {p.jdUrl ? (
                      <Link
                        href={`/browser?url=${encodeURIComponent(p.jdUrl)}&positionId=${p.id}`}
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                      >
                        <Globe className="size-3.5" />
                        网申
                      </Link>
                    ) : p.status !== "APPLIED" ? (
                      <Button size="sm" variant="secondary" onClick={() => setMarkingId(p.id)}>标记已投</Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="px-2" aria-label={`${p.company.name} · ${p.title} 的 AI 工具`} title="AI 工具：匹配、面试攻略、自荐信、口碑、简历深挖、定制简历" />}>
                        <Sparkles className="size-3.5" /><ChevronDown className="size-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => setMatchingId(p.id)}>选简历 · 匹配分析</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPrepId(p.id)}>面试攻略</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setLetterId(p.id)}>自荐信</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setInsightId(p.id)}>岗位口碑</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => router.push(`/resume-drill?position=${p.id}`)}><Crosshair className="size-3.5" />简历深挖</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push(`/resumes/tailored?positionId=${p.id}`)}><FileText className="size-3.5" />定制简历</DropdownMenuItem>
                        {p.jdUrl && p.status !== "APPLIED" && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setMarkingId(p.id)}>标记已投</DropdownMenuItem></>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <ApplicationRulesDialog positionId={p.id} trigger={<Button size="icon-sm" variant="ghost" aria-label="报名规则" title="报名规则"><ClipboardCheck className="size-3.5" /></Button>} />
                    <PositionFormDialog
                      mode="edit"
                      positionId={p.id}
                      initial={toEditInitial(p)}
                      trigger={<Button size="icon-sm" variant="ghost" aria-label="编辑" title="编辑"><Pencil className="size-3.5" /></Button>}
                    />
                    <ConfirmDeleteButton
                      trigger={<Button size="icon-sm" variant="ghost" aria-label="删除" title="删除"><Trash2 className="size-3.5" /></Button>}
                      title={`确定删除 ${p.company.name} · ${p.title} 吗？`}
                      onConfirm={() => handleDelete(p.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={anySalary ? 10 : 9} className="h-32 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <ListChecks className="size-8 text-muted-foreground/50" />
                  <span>
                    {positions.length === 0
                      ? "候选池为空，先添加一个感兴趣的岗位吧"
                      : "当前筛选条件下没有岗位"}
                  </span>
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
          initialGroupResult={preparing.groupInterviewPrep}
          open={!!prepId}
          onOpenChange={(open) => !open && setPrepId(null)}
        />
      )}

      {drafting && (
        <CoverLetterDialog
          positionId={drafting.id}
          positionLabel={`${drafting.company.name} · ${drafting.title}`}
          resumeVersions={resumeVersions}
          defaultResumeVersionId={defaultResumeVersionId}
          initialResult={drafting.coverLetter}
          open={!!letterId}
          onOpenChange={(open) => !open && setLetterId(null)}
        />
      )}

      {inspecting && (
        <CompanyInsightDialog
          positionId={inspecting.id}
          positionLabel={`${inspecting.company.name} · ${inspecting.title}`}
          open={!!insightId}
          onOpenChange={(open) => !open && setInsightId(null)}
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
          defaultSource={marking.source}
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
