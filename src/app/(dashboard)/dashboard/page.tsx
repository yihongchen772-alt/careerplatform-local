import Link from "next/link";
import { Clock, Send, Trophy, XCircle, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildTodos, type Todo } from "@/lib/todos";
import {
  computeFunnel,
  computeOutcomes,
  type FunnelLevel,
  type FunnelOutcomes,
} from "@/lib/funnel";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { PersonalTaskCard } from "@/components/dashboard/personal-task-card";
import { SendDigestButton } from "@/components/dashboard/send-digest-button";

export default async function DashboardPage() {
  const user = await requireUser();

  const [applications, positions, stageHistories, personalTasks, allPositions] =
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
  const todos = buildTodos(applications, positions, stageHistories, personalTasks);

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
      <h1 className="text-2xl font-semibold">总览</h1>

      <TodoCard todos={todos} />

      <PersonalTaskCard
        tasks={personalTasks.map((t) => ({
          id: t.id,
          title: t.title,
          note: t.note,
          dueDate: t.dueDate?.toISOString() ?? null,
          positionId: t.positionId,
          applicationId: t.applicationId,
          done: t.done,
        }))}
        positions={positionOptions}
        applications={applicationOptions}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="总投递数" value={total} icon={Send} />
        <StatCard label="进行中" value={inProgress} icon={Clock} />
        <StatCard label="Offer" value={offers} icon={Trophy} accent />
        <StatCard label="已结束" value={rejected} icon={XCircle} muted />
      </div>

      <FunnelCard levels={levels} total={total} outcomes={outcomes} />
    </div>
  );
}

function FunnelCard({
  levels,
  total,
  outcomes,
}: {
  levels: FunnelLevel[];
  total: number;
  outcomes: FunnelOutcomes;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>投递漏斗</CardTitle>
        <p className="text-sm text-muted-foreground">
          每一级是&ldquo;到达过这个阶段&rdquo;的投递数，右侧是相对上一级的转化率
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">还没有投递记录</p>
        ) : (
          <>
            {levels.map((level) => (
              <div key={level.stage} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 truncate text-xs text-muted-foreground sm:w-20 sm:text-sm">
                  {STAGE_LABELS[level.stage]}
                </span>
                <div className="h-6 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-6 rounded-r-sm bg-primary"
                    style={{ width: `${Math.max(level.shareOfTotal * 100, level.count > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right font-medium tabular-nums">
                  {level.count}
                </span>
                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {level.stepRate === null
                    ? ""
                    : `${Math.round(level.stepRate * 100)}%`}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span>已获 Offer {outcomes.offers}</span>
              <span>已接受 {outcomes.accepted}</span>
              <span>被拒 {outcomes.rejected}</span>
              <span>本人拒绝 {outcomes.declined}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  muted,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <Card>
      {/* Icon inline with the label rather than floating on the right — at four
          cards across, the right-aligned version left a wide dead gap. */}
      <CardContent className="space-y-1 pt-6">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon
            className={
              "size-4 shrink-0 " + (accent ? "text-primary" : muted ? "opacity-60" : "")
            }
          />
          <span className="truncate text-sm">{label}</span>
        </div>
        <p
          className={
            "text-4xl font-semibold tabular-nums " +
            (accent ? "text-primary" : muted ? "text-muted-foreground" : "")
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
