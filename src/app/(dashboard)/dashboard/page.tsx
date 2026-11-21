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
import { computeShareStats } from "@/lib/share-card";
import { isCalendarMailTask } from "@/lib/pending-mail";
import { mailTime, mailTimeOver } from "@/lib/mail-time";
import { loadPendingMail } from "@/lib/pending-mail-loader";
import { loadJourneyEvents } from "@/lib/journey-loader";
import { nudgeEvent } from "@/lib/journey";
import { ShareCardDialog } from "@/components/dashboard/share-card-dialog";
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
import { loadAutoProgressItems, loadAutoScheduleItems, loadMailScheduleConflicts } from "@/lib/auto-progress";
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
  const now = currentTimeMs();
  // Skip write transaction on cold dashboard visits when no pending captures exist.
  const pendingCaptureCount = await db.pendingApplicationChange.count({ where: { userId: user.id, status: "PENDING" } });
  const backlogPromise = (pendingCaptureCount > 0
    ? db.$transaction((tx) => learnFromBacklog(tx, user.id)).catch((error) => { console.error("[backlog]", error); return []; })
    : Promise.resolve([])
  ).then(() => loadBacklogNotices(user.id));

  const [
    scanHealth,
    backlog,
    autoUpdates,
    autoSchedules,
    mailConflicts,
    upcoming,
    justFinished,
    briefs,
    inferred,
    applications,
    allPositions,
    stageHistories,
    personalTasks,
    contacts,
    calendarEvents,
    pendingMailRows,
    recentEntries,
    journeyEvents,
    dbUser,
    resumeCount,
    leadCount,
    sheetCount,
    filledCount,
  ] = await Promise.all([
    getScanHealth(user.id),
    backlogPromise,
    loadAutoProgressItems(user.id),
    loadAutoScheduleItems(user.id),
    loadMailScheduleConflicts(user.id),
    loadUpcomingSchedule(user.id, new Date(now)),
    loadJustFinished(user.id, new Date(now)),
    loadBriefState(user.id, new Date(now)),
    loadInferredNotice(user.id),
    db.application.findMany({
      where: { userId: user.id },
      include: {
        company: { include: { aliases: { select: { alias: true } } } },
        stageHistory: { select: { stage: true } },
      },
      orderBy: { appliedDate: "desc" },
    }),
    db.position.findMany({
      where: { userId: user.id },
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
    db.contact.findMany({
      where: { userId: user.id, nextFollowUpAt: { not: null } },
      select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
    }),
    db.calendarEvent.findMany({ where: { userId: user.id, completedAt: null } }),
    loadPendingMail(user.id, now),
    db.journeyEntry.findMany({ where: { userId: user.id, createdAt: { gte: new Date(now - 8 * 86_400_000) } }, select: { about: true, createdAt: true } }),
    loadJourneyEvents(user.id, now),
    db.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true, contactEmail: true, defaultAiProvider: true, agentWeeklyReview: true, agentDailyBrief: true } }),
    db.resumeVersion.count({ where: { userId: user.id } }),
    db.jobLead.count({ where: { userId: user.id } }),
    db.postingSource.count({ where: { userId: user.id } }),
    // A form the 网申浏览器 filled leaves a draft or a learned answer behind.
    Promise.all([db.applicationDraft.count({ where: { userId: user.id } }), db.applicationMemory.count({ where: { userId: user.id } })]).then(([drafts, memories]) => drafts + memories),
  ]);

  const positions = allPositions.filter((p) => p.status !== "APPLIED");
  const total = applications.length;
  // The same counts as 投递记录's 总表: Offer takes in accepted and declined ones, 已结束 every closed one.
  const offers = applications.filter((a) => ["OFFER", "ACCEPTED", "DECLINED"].includes(a.currentStage)).length;
  const closed = applications.filter((a) => ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"].includes(a.currentStage)).length;
  const inProgress = total - closed;

  const shareStats = computeShareStats(applications.map((a) => ({ currentStage: a.currentStage, stageHistory: a.stageHistory, companyName: a.company.name, industry: a.company.industry })));
  const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts, calendarEvents);
  // 待办 is what the app watches for you; the tasks you wrote are in 我的待办,
  // and mail times waiting for the calendar are in 日历 — each in one place.
  // What 接下来 already lists right above isn't listed again.
  const listedAbove = new Set(upcoming.flatMap((item) => (item.source === "event" ? [`event-${item.sourceId}`] : item.source === "stage" ? [`next-${item.sourceId}`] : [])));
  const watchTodos = todos.filter((todo) => !todo.id.startsWith("task-") && !listedAbove.has(todo.id));
  // Mail with a time shows in 接下来 with its own 写入 button; only those with no
  // time need the calendar, so only those are pointed at.
  const mailNeedingTime = pendingMailRows.filter((row) => !row.time);
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
  const journeyNudge = nudgeEvent(journeyEvents, recentEntries.map((entry) => ({ about: entry.about, createdAt: entry.createdAt.toISOString() })), now);
  // One line under the greeting: today's / the next sitting, open 测评, what is pressing.
  const heroSummary = dashboardBrief(upcoming, todos, now);
  const showAgentBrief = Boolean(dbUser?.agentDailyBrief && dbUser.defaultAiProvider);
  const [dailyDigest, weeklyReview] = showAgentBrief
    ? [null, null]
    : await Promise.all([getTodayDigest(), getWeeklyReview()]);
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
          <span className="absolute -right-10 -top-16 size-56 rounded-full bg-[var(--primary)]/12 blur-2xl" />
          <span className="absolute right-[18%] top-6 size-10 rotate-12 rounded-2xl bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/15" />
          <span className="absolute right-[8%] bottom-6 size-16 -rotate-6 rounded-[1.4rem] bg-gradient-to-br from-[var(--primary)]/16 to-transparent ring-1 ring-[var(--primary)]/12" />
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
      <AutoProgressBanner items={autoUpdates} schedules={autoSchedules} conflicts={mailConflicts} />

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

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4 md:gap-4">
        <StatCard label="总投递数" sub="累计全部网申记录" value={total} href="/applications?f=all" icon={Send} tone="brand" />
        <StatCard label="进行中" sub="简历筛选 · 笔试 · 面试" value={inProgress} href="/applications?f=active" icon={Clock} tone="amber" />
        <StatCard label="Offer" sub="已收获录用意向" value={offers} href="/applications?f=offer" icon={Trophy} tone="emerald" />
        <StatCard label="已结束" sub="已归档或流程结束" value={closed} href="/applications?f=closed" icon={XCircle} tone="slate" />
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

      {total > 0 && (
        <section className="surface-card flex flex-wrap items-center justify-between gap-4 rounded-xl px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">阶段转化概览</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              共 {total} 条投递 · {inProgress} 条进行中 · {offers} 个 Offer · 完整漏斗与简历/渠道转化见「转化率」
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/insights" className="inline-flex h-8 items-center gap-1 rounded-full border border-border/70 bg-card/80 px-3 text-xs font-medium hover:bg-muted">
              查看转化分析 <ArrowUpRight className="size-3.5" />
            </Link>
            <ShareCardDialog stats={shareStats} />
          </div>
        </section>
      )}

      {total > 0 && <OnboardingCard steps={onboardingSteps} />}
    </div>
  );
}

/** Semantic status colors remain stable across theme palettes. */
const STAT_TONES = {
  brand: {
    badge: "bg-primary/12 text-primary",
    value: "text-foreground",
  },
  amber: {
    badge: "bg-amber-500/14 text-amber-600 dark:text-amber-400",
    value: "text-amber-600 dark:text-amber-400",
  },
  emerald: {
    badge: "bg-emerald-500/14 text-emerald-600 dark:text-emerald-400",
    value: "text-emerald-600 dark:text-emerald-400",
  },
  slate: {
    badge: "bg-foreground/[0.06] text-muted-foreground",
    value: "text-muted-foreground",
  },
} as const;

function StatCard({
  label,
  sub,
  value,
  href,
  icon: Icon,
  tone,
}: {
  label: string;
  sub?: string;
  value: number;
  href: string;
  icon: LucideIcon;
  tone: keyof typeof STAT_TONES;
}) {
  const t = STAT_TONES[tone];
  return (
    <Link href={href} className="group block outline-none">
      <Card className="stat-tile relative overflow-hidden rounded-xl transition-transform duration-300 ease-(--ease-apple) group-hover:-translate-y-0.5" data-tone={tone}>
        <CardContent className="flex min-h-30 flex-col justify-between gap-3 py-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold tracking-tight text-foreground/85">{label}</p>
              {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
            </div>
            <div className={`stat-icon flex size-9 shrink-0 items-center justify-center rounded-[11px] transition-transform duration-300 ease-(--ease-apple) group-hover:scale-105 ${t.badge}`}>
              <Icon className="size-4" strokeWidth={2} />
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-4xl font-semibold tracking-tight tabular-nums ${t.value}`}>
              {value}
            </p>
            <ArrowUpRight className="size-3.5 text-muted-foreground/50 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
