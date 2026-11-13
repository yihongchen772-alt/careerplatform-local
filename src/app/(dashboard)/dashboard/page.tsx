import Link from "next/link";
import { ArrowUpRight, Clock, Mail, NotebookPen, Send, Trophy, XCircle, type LucideIcon } from "lucide-react";
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
import { isCalendarMailTask } from "@/lib/pending-mail";
import { mailTime, mailTimeOver } from "@/lib/mail-time";
import { loadPendingMail } from "@/lib/pending-mail-loader";
import { loadJourneyEvents } from "@/lib/journey-loader";
import { nudgeEvent } from "@/lib/journey";
import { ShareCardDialog } from "@/components/dashboard/share-card-dialog";
import { FunnelCard } from "@/components/insights/funnel-card";
import { PersonalTaskCard } from "@/components/dashboard/personal-task-card";
import { DailyDigestCard } from "@/components/dashboard/daily-digest-card";
import { getTodayDigest } from "@/lib/actions/daily-digest";
import { WeeklyReviewCard } from "@/components/dashboard/weekly-review-card";
import { getWeeklyReview } from "@/lib/actions/weekly-review";
import { OnboardingCard } from "@/components/dashboard/onboarding-card";
import { FirstRunCard } from "@/components/dashboard/first-run-card";
import { duplicateImportedTaskIds } from "@/lib/inbox-identity";
import { AutoProgressBanner } from "@/components/applications/auto-progress-banner";
import { ScanHealthBanner } from "@/components/applications/scan-health-banner";
import { getScanHealth } from "@/lib/scan-health";
import { loadAutoProgressItems, loadAutoScheduleItems } from "@/lib/auto-progress";
import { UpcomingSchedule } from "@/components/schedule/upcoming-schedule";
import { JustFinishedStrip } from "@/components/schedule/just-finished";
import { AgentBriefCard } from "@/components/dashboard/agent-brief-card";
import { loadBriefState } from "@/lib/agent/brief";
import { loadJustFinished, loadUpcomingSchedule } from "@/lib/schedule-loader";
import { isTerminalStage } from "@/lib/interview-schedule";
import { currentTimeMs } from "@/lib/dates";
import { dashboardBrief } from "@/lib/dashboard-brief";

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
  const [autoUpdates, autoSchedules, upcoming, justFinished, briefs, inferred] = await Promise.all([
    loadAutoProgressItems(user.id),
    loadAutoScheduleItems(user.id),
    loadUpcomingSchedule(user.id, new Date(now)),
    loadJustFinished(user.id, new Date(now)),
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
  // The same counts as 投递记录's 总表: Offer takes in accepted and declined ones, 已结束 every closed one.
  const offers = applications.filter((a) => ["OFFER", "ACCEPTED", "DECLINED"].includes(a.currentStage)).length;
  const closed = applications.filter((a) => ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"].includes(a.currentStage)).length;
  const inProgress = total - closed;

  const { levels } = computeFunnel(funnelApps);
  const outcomes = computeOutcomes(funnelApps);
  const shareStats = computeShareStats(funnelApps.map((a) => ({ currentStage: a.currentStage, stageHistory: a.stageHistory, companyName: a.company.name, industry: a.company.industry })));
  const calendarEvents = await db.calendarEvent.findMany({ where: { userId: user.id, completedAt: null } });
  const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts, calendarEvents);
  // 待办 is what the app watches for you; the tasks you wrote are in 我的待办,
  // and mail times waiting for the calendar are in 日历 — each in one place.
  // What 接下来 already lists right above isn't listed again.
  const listedAbove = new Set(upcoming.flatMap((item) => (item.source === "event" ? [`event-${item.sourceId}`] : item.source === "stage" ? [`next-${item.sourceId}`] : [])));
  const watchTodos = todos.filter((todo) => !todo.id.startsWith("task-") && !listedAbove.has(todo.id));
  // Mail with a time shows in 接下来 with its own 写入 button; only those with no
  // time need the calendar, so only those are pointed at.
  const mailNeedingTime = (await loadPendingMail(user.id, now)).filter((row) => !row.time);
  // A mail whose time has passed has nothing left to do — taken back (撤销) or never
  // acted on: once older than the pending window it would otherwise sit here for good.
  const ownTasks = personalTasks.filter((task) => {
    if (isCalendarMailTask(task, now)) return false;
    const time = task.sourceMailKey && !task.done ? mailTime(task.mailEventDraft) : null;
    return !(time && mailTimeOver(time) <= now);
  });
  // A task may still name a calendar item that has since gone: no 「导出 ICS」 for that.
  const linkedEvents = ownTasks.flatMap((task) => (task.mailEventId ? [task.mailEventId] : []));
  const liveEvents = new Set(linkedEvents.length ? (await db.calendarEvent.findMany({ where: { id: { in: linkedEvents } }, select: { id: true } })).map((event) => event.id) : []);
  // A result in the last two days with nothing written about it: one gentle line, not a card.
  const recentEntries = await db.journeyEntry.findMany({ where: { userId: user.id, createdAt: { gte: new Date(now - 8 * 86_400_000) } }, select: { about: true, createdAt: true } });
  const journeyNudge = nudgeEvent(await loadJourneyEvents(user.id, now), recentEntries.map((entry) => ({ about: entry.about, createdAt: entry.createdAt.toISOString() })), now);
  // One line under the greeting: today's / the next sitting, open 测评, what is pressing.
  const heroSummary = dashboardBrief(upcoming, todos, now);
  const dailyDigest = await getTodayDigest();
  const weeklyReview = await getWeeklyReview();

  const [dbUser, resumeCount, leadCount, sheetCount, filledCount] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true, contactEmail: true, defaultAiProvider: true, agentWeeklyReview: true, agentDailyBrief: true } }),
    db.resumeVersion.count({ where: { userId: user.id } }),
    db.jobLead.count({ where: { userId: user.id } }),
    db.postingSource.count({ where: { userId: user.id } }),
    // A form the 网申浏览器 filled leaves a draft or a learned answer behind.
    Promise.all([db.applicationDraft.count({ where: { userId: user.id } }), db.applicationMemory.count({ where: { userId: user.id } })]).then(([drafts, memories]) => drafts + memories),
  ]);
  // 上手四步, in the order they pay off: your details, an AI, where the jobs are, the first 一键填写.
  const onboardingSteps = [
    {
      key: "profile",
      title: "上传简历，填好网申资料",
      hint: "姓名、手机、邮箱、学校和一份简历——一键填写、岗位匹配、简历深挖都从这里出发",
      href: resumeCount > 0 ? "/settings?tab=autofill" : "/resumes",
      done: resumeCount > 0 && !!(dbUser?.name && dbUser.phone && dbUser.contactEmail),
    },
    {
      key: "ai",
      title: "配置一个 AI Key",
      hint: "DeepSeek / Kimi / Qwen / 智谱 / Gemini 都行，Gemini 有免费额度",
      href: "/settings?tab=ai",
      done: !!dbUser?.defaultAiProvider,
    },
    {
      key: "sheet",
      title: "订阅一份校招信息表",
      hint: "贴一个在线校招表（飞书多维表格）的链接，每天自动同步，按届次、快截止筛",
      href: "/leads?view=postings",
      done: sheetCount > 0 || leadCount > 0,
    },
    {
      key: "fill",
      title: "在网申浏览器里一键填写一次",
      hint: "打开任意公司的网申页，点右上角「一键填写」，看看能填多少",
      href: "/browser",
      done: filledCount > 0 || applications.some((app) => app.applyUrl),
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
      {/* The opening card: the same light card as the other pages, with today in one line. */}
      <header className="hero-card">
        <div aria-hidden="true" className="hero-decor pointer-events-none absolute inset-0">
          <span className="absolute -right-10 -top-16 size-56 rounded-full bg-white/15 blur-2xl" />
          <span className="absolute right-[18%] top-6 size-10 rotate-12 rounded-2xl bg-white/25 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.25)]" />
          <span className="absolute right-[8%] bottom-6 size-16 -rotate-6 rounded-[1.4rem] bg-gradient-to-br from-white/45 to-white/10 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.3)]" />
        </div>
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="hero-sub text-sm text-muted-foreground">{new Date(now).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</p>
            <h1 className="mt-1 font-semibold">{greeting(new Date(now))}{dbUser?.name && dbUser.name !== "我" ? `，${dbUser.name}` : ""}</h1>
            <ul aria-label="今天的概况" className="mt-3 flex max-w-4xl flex-wrap gap-2">
              {heroSummary.map((part) => (
                <li key={part} className="min-w-0 max-w-full">
                  <Link href={/邮件里/.test(part) ? "/calendar" : /件事/.test(part) ? "#today-work" : "#upcoming"} title={part} className="hero-pill block max-w-full truncate rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-75">{part}</Link>
                </li>
              ))}
            </ul>
          </div>
          <Link href="/applications" className="hero-action inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            投递记录 <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </header>

      {total === 0 && (
        <>
          <FirstRunCard />
          <OnboardingCard steps={onboardingSteps} defaultOpen />
        </>
      )}

      <InferredProfileBanner due={inferred.due} initial={inferred.record} />
      <LearnedBacklogBanner notices={backlog} showLink />
      {scanHealth.failing && <ScanHealthBanner error={scanHealth.error} since={scanHealth.since?.toISOString() ?? null} lastOkAt={scanHealth.lastOkAt?.toISOString() ?? null} />}
      <AutoProgressBanner items={autoUpdates} schedules={autoSchedules} />

      <JustFinishedStrip items={justFinished} now={now} />

      {/* Today's interviews, one click from their meeting links — what to act on first. */}
      <div id="upcoming" className="scroll-mt-4" />
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

      {mailNeedingTime.length > 0 && (
        <Link href="/calendar" className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10">
          <Mail className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">邮件里有 {mailNeedingTime.length} 条面试 / 笔试没读到时间，点这里补上</span>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {journeyNudge && (
        <Link href={`/journey?about=${encodeURIComponent(journeyNudge.about)}`} className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-sm transition-colors hover:bg-muted/60">
          <NotebookPen className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{journeyNudge.about.split(" · ")[0]} 有结果了，要不要写两句心情？</span>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="today-work" className="scroll-mt-4 text-lg font-semibold tracking-[-0.025em]">今日工作台</h2>
          <p className="mt-1 text-xs text-muted-foreground">先处理眼前的事，再回看整体进展。</p>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] xl:items-start">
        <div className="space-y-5">
          {/* 小欧's 今日简报 at the top says the same; the older digest only without it. */}
          {!(dbUser?.agentDailyBrief && dbUser.defaultAiProvider) && <DailyDigestCard initial={dailyDigest} />}
          <TodoCard todos={watchTodos} />
        </div>
        <div className="space-y-5">
          <PersonalTaskCard
            duplicateMailTaskCount={duplicateImportedTaskIds(ownTasks).length}
            tasks={ownTasks.map((t) => ({
              id: t.id,
              title: t.title,
              note: t.note,
              dueDate: t.dueDate?.toISOString() ?? null,
              dueDateEnd: t.dueDateEnd?.toISOString() ?? null,
              positionId: t.positionId,
              applicationId: t.applicationId,
              done: t.done,
              mailEventDraft: t.mailEventDraft, mailEventId: t.mailEventId && liveEvents.has(t.mailEventId) ? t.mailEventId : null,
              fromMail: !!t.sourceMailKey,
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

      {total > 0 && <OnboardingCard steps={onboardingSteps} />}
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
