import Link from "next/link";
import { Clock, Send, Trophy, XCircle, type LucideIcon } from "lucide-react";
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
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">总览</h1>

      <OnboardingCard steps={onboardingSteps} />

      <DailyDigestCard initial={dailyDigest} />

      <WeeklyReviewCard initial={weeklyReview} />

      <TodoCard todos={todos} />

      <PersonalTaskCard
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="总投递数" value={total} icon={Send} tone="brand" />
        <StatCard label="进行中" value={inProgress} icon={Clock} tone="amber" />
        <StatCard label="Offer" value={offers} icon={Trophy} tone="emerald" />
        <StatCard label="已结束" value={rejected} icon={XCircle} tone="slate" />
      </div>

      <FunnelCard levels={levels} total={total} outcomes={outcomes} />
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
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>待办</CardTitle>
        <SendDigestButton />
      </CardHeader>
      <CardContent className="space-y-2">
        {todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            暂时没有要处理的事，保持住
          </p>
        ) : (
          <>
            {todos.map((todo) => {
              const style = URGENCY_STYLE[todo.urgency];
              return (
                <Link
                  key={todo.id}
                  href={todo.href}
                  className="flex flex-col gap-1 rounded-md border p-2 text-sm hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
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

/** Fixed semantic gradients rather than theme tokens — these read as status
 * (neutral/progress/success/closed), which stays meaningful regardless of
 * which of the three color palettes is active. Only "brand" ties to the
 * current palette, for the one card that's just a raw count with no status
 * of its own. */
const STAT_TONES = {
  brand: {
    badge: "bg-[image:var(--gradient-accent)]",
    glow: "color-mix(in oklch, var(--glow-1), transparent 55%)",
    value: "",
  },
  amber: {
    badge: "bg-[linear-gradient(135deg,#f59e0b,#f97316)]",
    glow: "color-mix(in oklch, #f59e0b, transparent 55%)",
    value: "",
  },
  emerald: {
    badge: "bg-[linear-gradient(135deg,#10b981,#059669)]",
    glow: "color-mix(in oklch, #10b981, transparent 55%)",
    value: "text-emerald-600 dark:text-emerald-400",
  },
  slate: {
    badge: "bg-[linear-gradient(135deg,#64748b,#475569)]",
    glow: "color-mix(in oklch, #64748b, transparent 60%)",
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
    <Card>
      <CardContent className="flex items-center gap-3.5 pt-6">
        <div
          className={`flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_4px_14px_-4px_var(--tone-glow)] ${t.badge}`}
          style={{ "--tone-glow": t.glow } as React.CSSProperties}
        >
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
