import Link from "next/link";
import { ArrowUpRight, Clock, Send, Trophy, XCircle, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { buildTodos } from "@/lib/todos";
import { TodoCard } from "@/components/dashboard/todo-card";
import { InferredProfileBanner } from "@/components/dashboard/inferred-profile-banner";
import { loadInferredNotice } from "@/lib/agent/infer-profile";
import { LearnedBacklogBanner } from "@/components/settings/learned-backlog-banner";
import { learnFromBacklog, loadBacklogNotices } from "@/lib/profile-backlog";
import { computeFunnel, computeOutcomes } from "@/lib/funnel";
import { computeShareStats } from "@/lib/share-card";
import { ShareCardDialog } from "@/components/dashboard/share-card-dialog";
import { FunnelCard } from "@/components/insights/funnel-card";
import { PersonalTaskCard } from "@/components/dashboard/personal-task-card";
import { DailyDigestCard } from "@/components/dashboard/daily-digest-card";
import { getTodayDigest } from "@/lib/actions/daily-digest";
import { WeeklyReviewCard } from "@/components/dashboard/weekly-review-card";
import { getWeeklyReview } from "@/lib/actions/weekly-review";
import { OnboardingCard } from "@/components/dashboard/onboarding-card";
import { duplicateImportedTaskIds } from "@/lib/inbox-identity";
import { AutoProgressBanner } from "@/components/applications/auto-progress-banner";
import { ScanHealthBanner } from "@/components/applications/scan-health-banner";
import { getScanHealth } from "@/lib/scan-health";
import { loadAutoProgressItems, loadAutoScheduleItems } from "@/lib/auto-progress";
import { UpcomingSchedule } from "@/components/schedule/upcoming-schedule";
import { AgentBriefCard } from "@/components/dashboard/agent-brief-card";
import { loadBriefState } from "@/lib/agent/brief";
import { loadUpcomingSchedule } from "@/lib/schedule-loader";
import { isTerminalStage } from "@/lib/interview-schedule";
import { currentTimeMs } from "@/lib/dates";

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const scanHealth = await getScanHealth(user.id);
  const now = currentTimeMs();
  // 待核对 captures that fill a blank in 网申资料 are learned here too (with 撤销).
  const backlog = await db.$transaction((tx) => learnFromBacklog(tx, user.id)).catch((error) => { console.error("[backlog]", error); return []; }).then(() => loadBacklogNotices(user.id));
  const [autoUpdates, autoSchedules, upcoming, briefs, inferred] = await Promise.all([
    loadAutoProgressItems(user.id),
    loadAutoScheduleItems(user.id),
    loadUpcomingSchedule(user.id, new Date(now)),
    loadBriefState(user.id, new Date(now)),
    loadInferredNotice(user.id),
  ]);

  const [applications, positions, stageHistories, personalTasks, allPositions, contacts] =
    await Promise.all([
      db.application.findMany({
        where: { userId: user.id },
        include: { company: { include: { aliases: { select: { alias: true } } } } },
        orderBy: { appliedDate: "desc" },
      }),
      db.position.findMany({
        where: { userId: user.id, status: { not: "APPLIED" } },
        include: { company: true },
      }),
      db.stageHistory.findMany({
        where: { application: { userId: user.id }, nextDeadline: { not: null } },
        include: { application: { include: { company: true } } },
      }),
      db.personalTask.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
      // Every position, not just the not-yet-applied ones above — a personal
      // task can link to anything in the pool, including ones already applied.
      db.position.findMany({
        where: { userId: user.id },
        include: { company: true },
      }),
      db.contact.findMany({
        where: { userId: user.id, nextFollowUpAt: { not: null } },
        select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
      }),
    ]);

  const funnelApps = await db.application.findMany({
    where: { userId: user.id },
    select: { currentStage: true, stageHistory: { select: { stage: true } }, company: { select: { name: true, industry: true } } },
  });

  const total = applications.length;
  const offers = applications.filter((a) => a.currentStage === "OFFER" || a.currentStage === "ACCEPTED").length;
  const closed = applications.filter((a) => ["REJECTED", "DECLINED", "WITHDRAWN", "CANCELLED"].includes(a.currentStage)).length;
  const inProgress = total - offers - closed;

  const { levels } = computeFunnel(funnelApps);
  const outcomes = computeOutcomes(funnelApps);
  const shareStats = computeShareStats(funnelApps.map((a) => ({ currentStage: a.currentStage, stageHistory: a.stageHistory, companyName: a.company.name, industry: a.company.industry })));
  const calendarEvents = await db.calendarEvent.findMany({ where: { userId: user.id } });
  const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts, calendarEvents);
  // One line under the greeting: this week's interviews / tests, the next one, what is pressing.
  const scheduled = upcoming.filter((item) => item.source !== "mail");
  const next = scheduled[0];
  const pressing = todos.filter((todo) => todo.urgency !== "soon").length;
  const heroSummary = [
    scheduled.length ? `7 天内 ${scheduled.length} 场面试 / 笔试` : "7 天内没有面试和笔试",
    next ? `下一场：${next.companyName ? `${next.companyName} · ` : ""}${next.title}` : null,
    pressing ? `${pressing} 件事今明两天要处理` : "眼前没有要赶的事",
  ].filter(Boolean).join("　·　");
  const dailyDigest = await getTodayDigest();
  const weeklyReview = await getWeeklyReview();

  const [dbUser, resumeCount, leadCount] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true, contactEmail: true, defaultAiProvider: true, agentWeeklyReview: true, agentDailyBrief: true } }),
    db.resumeVersion.count({ where: { userId: user.id } }),
    db.jobLead.count({ where: { userId: user.id } }),
  ]);
  const onboardingSteps = [
    {
      key: "resume",
      title: "上传一份简历",
      hint: "简历体检、岗位匹配、网申自动填充、简历深挖都从它出发",
      href: "/resumes",
      done: resumeCount > 0,
    },
    {
      key: "ai",
      title: "配置一个 AI Key",
      hint: "DeepSeek / Kimi / Qwen / 智谱 / Gemini 都行，Gemini 有免费额度",
      href: "/settings?tab=ai",
      done: !!dbUser?.defaultAiProvider,
    },
    {
      key: "profile",
      title: "填好网申资料",
      hint: "姓名、手机、邮箱、学校——网申表单一键填充靠它",
      href: "/settings",
      done: !!(dbUser?.name && dbUser.phone && dbUser.contactEmail),
    },
    {
      key: "position",
      title: "加第一个岗位",
      hint: "导入秋招信息表，或在网申浏览器里逛到岗位直接「收藏」",
      href: allPositions.length > 0 || leadCount > 0 ? "/pool" : "/leads",
      done: allPositions.length > 0 || leadCount > 0 || applications.length > 0,
    },
  ];

  // Prefixed because a position and the application it turned into share the
  // same company/title — without this the picker shows two identical rows.
  const positionOptions = allPositions.map((p) => ({
    id: p.id,
    label: `候选：${p.company.name} · ${p.title}`,
  }));
  const applicationOptions = applications.map((a) => ({
    id: a.id,
    label: `投递：${a.company.name} · ${a.title}`,
  }));

  return (
    <div className="mx-auto max-w-[110rem] space-y-7">
      {/* The opening card: a brand gradient in 柔光, a plain heading in the other styles. */}
      <header className="hero-card">
        <div aria-hidden="true" className="hero-decor pointer-events-none absolute inset-0">
          <span className="absolute -right-10 -top-16 size-56 rounded-full bg-white/15 blur-2xl" />
          <span className="absolute right-[18%] top-6 size-10 rotate-12 rounded-2xl bg-white/25 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.25)]" />
          <span className="absolute right-[8%] bottom-6 size-16 -rotate-6 rounded-[1.4rem] bg-gradient-to-br from-white/45 to-white/10 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.3)]" />
          <span className="absolute right-[28%] bottom-8 size-6 rounded-full bg-amber-200/80 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.25)]" />
        </div>
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="hero-sub text-sm text-muted-foreground">{new Date(now).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</p>
            <h1 className="mt-1 font-semibold">{greeting(new Date(now))}{dbUser?.name && dbUser.name !== "我" ? `，${dbUser.name}` : ""}</h1>
            <p className="hero-sub mt-2 max-w-xl text-sm text-muted-foreground">{heroSummary}</p>
          </div>
          <Link href="/applications" className="hero-action inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            投递记录 <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </header>

      <InferredProfileBanner due={inferred.due} initial={inferred.record} />
      <LearnedBacklogBanner notices={backlog} showLink />
      {scanHealth.failing && <ScanHealthBanner error={scanHealth.error} since={scanHealth.since?.toISOString() ?? null} lastOkAt={scanHealth.lastOkAt?.toISOString() ?? null} />}
      <AutoProgressBanner items={autoUpdates} schedules={autoSchedules} />

      {/* Today's interviews, one click from their meeting links — what to act on first. */}
      {applications.length > 0 && (
        <UpcomingSchedule
          items={upcoming}
          now={now}
          applications={applications.filter((a) => !isTerminalStage(a.currentStage)).map((a) => ({ id: a.id, companyName: a.company.name, title: a.title, currentStage: a.currentStage, aliases: a.company.aliases.map((entry) => entry.alias) }))}
        />
      )}

      <AgentBriefCard {...briefs} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard label="总投递数" value={total} icon={Send} tone="brand" />
        <StatCard label="进行中" value={inProgress} icon={Clock} tone="amber" />
        <StatCard label="Offer" value={offers} icon={Trophy} tone="emerald" />
        <StatCard label="已结束" value={closed} icon={XCircle} tone="slate" />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.025em]">今日工作台</h2>
          <p className="mt-1 text-xs text-muted-foreground">先处理眼前的事，再回看整体进展。</p>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] xl:items-start">
        <div className="space-y-5">
          {/* 小欧's 今日简报 at the top says the same; the older digest only without it. */}
          {!(dbUser?.agentDailyBrief && dbUser.defaultAiProvider) && <DailyDigestCard initial={dailyDigest} />}
          <TodoCard todos={todos} />
        </div>
        <div className="space-y-5">
          <PersonalTaskCard
            duplicateMailTaskCount={duplicateImportedTaskIds(personalTasks).length}
            tasks={personalTasks.map((t) => ({
              id: t.id,
              title: t.title,
              note: t.note,
              dueDate: t.dueDate?.toISOString() ?? null,
              dueDateEnd: t.dueDateEnd?.toISOString() ?? null,
              positionId: t.positionId,
              applicationId: t.applicationId,
              done: t.done,
              mailEventDraft: t.mailEventDraft, mailEventId: t.mailEventId,
            }))}
            positions={positionOptions}
            applications={applicationOptions}
          />
          {/* 小欧's 周复盘 above covers the week once it is on; the older card only without it. */}
          {!(dbUser?.agentWeeklyReview && dbUser.defaultAiProvider) && <WeeklyReviewCard initial={weeklyReview} />}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.025em]">进展回顾</h2>
            <p className="mt-1 text-xs text-muted-foreground">用阶段转化看清求职节奏。</p>
          </div>
          {total > 0 && <ShareCardDialog stats={shareStats} />}
        </div>
        <FunnelCard levels={levels} total={total} outcomes={outcomes} />
      </div>

      <OnboardingCard steps={onboardingSteps} />
    </div>
  );
}

/** Semantic status colors remain stable across theme palettes. */
const STAT_TONES = {
  brand: {
    badge: "bg-primary/10 text-primary",
    value: "",
  },
  amber: {
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    value: "",
  },
  emerald: {
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    value: "text-emerald-600 dark:text-emerald-400",
  },
  slate: {
    badge: "bg-slate-500/10 text-slate-500 dark:text-slate-400",
    value: "text-muted-foreground",
  },
} as const;

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: keyof typeof STAT_TONES;
}) {
  const t = STAT_TONES[tone];
  return (
    // stat-tile + data-tone: a pastel gradient in the 柔光 style (globals.css).
    <Card className="stat-tile overflow-hidden rounded-xl" data-tone={tone}>
      <CardContent className="flex min-h-28 flex-col justify-between gap-4 py-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
          <div className={`stat-icon flex size-9 shrink-0 items-center justify-center rounded-xl ${t.badge}`}>
            <Icon className="size-4" />
          </div>
        </div>
        <p className={`text-4xl font-semibold tracking-tight tabular-nums ${t.value}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
