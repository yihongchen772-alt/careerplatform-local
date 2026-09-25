import Link from "next/link";
import { ArrowUpRight, Clock, Send, Trophy, XCircle, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildTodos, type Todo } from "@/lib/todos";
import { computeFunnel, computeOutcomes } from "@/lib/funnel";
import { FunnelCard } from "@/components/insights/funnel-card";
import { PersonalTaskCard } from "@/components/dashboard/personal-task-card";
import { SendDigestButton } from "@/components/dashboard/send-digest-button";
import { DailyDigestCard } from "@/components/dashboard/daily-digest-card";
import { getTodayDigest } from "@/lib/actions/daily-digest";
import { WeeklyReviewCard } from "@/components/dashboard/weekly-review-card";
import { getWeeklyReview } from "@/lib/actions/weekly-review";
import { OnboardingCard } from "@/components/dashboard/onboarding-card";
import { duplicateImportedTaskIds } from "@/lib/inbox-identity";

export default async function DashboardPage() {
  const user = await requireUser();

  const [applications, positions, stageHistories, personalTasks, allPositions, contacts] =
    await Promise.all([
      db.application.findMany({
        where: { userId: user.id },
        include: { company: true },
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
    select: { currentStage: true, stageHistory: { select: { stage: true } } },
  });

  const total = applications.length;
  const offers = applications.filter((a) => a.currentStage === "OFFER" || a.currentStage === "ACCEPTED").length;
  const rejected = applications.filter((a) => a.currentStage === "REJECTED" || a.currentStage === "DECLINED").length;
  const inProgress = total - offers - rejected;

  const { levels } = computeFunnel(funnelApps);
  const outcomes = computeOutcomes(funnelApps);
  const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts);
  const dailyDigest = await getTodayDigest();
  const weeklyReview = await getWeeklyReview();

  const [dbUser, resumeCount, leadCount] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true, contactEmail: true, defaultAiProvider: true } }),
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
      href: "/settings",
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
      <div className="relative overflow-hidden rounded-[1.8rem] border border-border/65 bg-card/75 px-5 py-6 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-7 sm:py-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
              YOUR WORKSPACE
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">总览</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">把重要进展、下一步行动和求职节奏，都放在一眼能掌握的地方。</p>
          </div>
          <Link href="/applications" className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/65 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">
            查看投递记录 <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard label="总投递数" value={total} icon={Send} tone="brand" />
        <StatCard label="进行中" value={inProgress} icon={Clock} tone="amber" />
        <StatCard label="Offer" value={offers} icon={Trophy} tone="emerald" />
        <StatCard label="已结束" value={rejected} icon={XCircle} tone="slate" />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.025em]">今日工作台</h2>
          <p className="mt-1 text-xs text-muted-foreground">先处理眼前的事，再回看整体进展。</p>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr] xl:items-start">
        <div className="space-y-5">
          <DailyDigestCard initial={dailyDigest} />
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
            }))}
            positions={positionOptions}
            applications={applicationOptions}
          />
          <WeeklyReviewCard initial={weeklyReview} />
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.025em]">进展回顾</h2>
          <p className="mt-1 text-xs text-muted-foreground">用阶段转化看清求职节奏。</p>
        </div>
        <FunnelCard levels={levels} total={total} outcomes={outcomes} />
      </div>

      <OnboardingCard steps={onboardingSteps} />
    </div>
  );
}

const URGENCY_STYLE: Record<Todo["urgency"], { badge: string; label: string }> = {
  overdue: { badge: "destructive", label: "已逾期" },
  urgent: { badge: "destructive", label: "很急" },
  soon: { badge: "secondary", label: "临近" },
};

function TodoCard({ todos }: { todos: Todo[] }) {
  return (
    <Card className="rounded-[1.5rem] border-border/65 bg-card/75 shadow-[0_16px_45px_-38px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>待办</CardTitle>
        <SendDigestButton />
      </CardHeader>
      <CardContent className="space-y-2">
        {todos.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-5">
            <p className="text-sm font-medium">暂无待处理事项</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">有新的截止时间或阶段更新时，会自动出现在这里。</p>
          </div>
        ) : (
          <>
            {todos.map((todo) => {
              const style = URGENCY_STYLE[todo.urgency];
              return (
                <Link
                  key={todo.id}
                  href={todo.href}
                  className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/35 p-3 text-sm transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{todo.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {todo.sublabel}
                    </p>
                  </div>
                  <Badge
                    variant={
                      style.badge as "destructive" | "secondary"
                    }
                    className="self-start sm:self-auto"
                  >
                    {style.label}
                  </Badge>
                </Link>
              );
            })}
            <p className="pt-1 text-xs text-muted-foreground">
              处理完对应记录（更新阶段、标记已投）后，这里会自动消失
            </p>
          </>
        )}
      </CardContent>
    </Card>
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
    <Card className="overflow-hidden rounded-[1.5rem] border-border/65 bg-card/75 shadow-[0_16px_45px_-38px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      <CardContent className="flex items-center gap-3.5 py-5 sm:py-6">
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${t.badge}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className={`text-3xl font-semibold tracking-tight tabular-nums ${t.value}`}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
