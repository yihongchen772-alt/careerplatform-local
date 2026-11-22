import { db } from "@/lib/db";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { isTerminalStage } from "@/lib/interview-schedule";
import type { AgentMode } from "@/lib/agent/modes";

export type ProactiveNudgeAction =
  | { kind: "generate_brief"; applicationId: string }
  | { kind: "ask_xiaoou"; prompt: string; mode?: AgentMode; send?: boolean }
  | { kind: "link"; href: string };

export type ProactiveNudge = {
  id: string;
  kind: "interview_prep" | "schedule_conflict" | "stale_followup" | "deadline_soon" | "offer_decision";
  urgency: "high" | "medium" | "low";
  title: string;
  detail: string;
  ctaLabel: string;
  action: ProactiveNudgeAction;
  href?: string;
};

const PREP_STAGES = new Set([
  "OA",
  "ASSESSMENT",
  "AI_INTERVIEW",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "INTERVIEW_3",
  "HR_INTERVIEW",
]);

/**
 * Event-driven proactive radar for 小欧.
 * Zero LLM cost: inspects upcoming interviews/exams lacking a brief, tight/overlapping
 * schedules, multi-offer decisions, soon-expiring candidate positions, and stale
 * applications, returning at most 4 prioritized one-click action nudges.
 */
export async function computeProactiveNudges(userId: string, now = new Date()): Promise<ProactiveNudge[]> {
  const nowMs = now.getTime();
  const in72h = new Date(nowMs + 72 * 3_600_000);
  const in7d = new Date(nowMs + 7 * 86_400_000);

  const [applications, expiringPositions] = await Promise.all([
    db.application.findMany({
      where: { userId },
      include: {
        company: { select: { name: true } },
        interviewBrief: { select: { id: true, updatedAt: true } },
        stageHistory: {
          where: { completedAt: null, nextDeadline: { not: null } },
          select: { id: true, stage: true, stageLabel: true, nextDeadline: true, nextHasTime: true },
          orderBy: { nextDeadline: "asc" },
        },
      },
      orderBy: { currentStageDate: "desc" },
    }),
    db.position.findMany({
      where: {
        userId,
        status: { in: ["EVALUATING", "PLANNED"] },
        deadline: { gte: now, lte: in72h },
      },
      include: {
        company: { select: { name: true } },
        positionMatches: { orderBy: { updatedAt: "desc" }, take: 1, select: { matchScore: true } },
      },
      orderBy: { deadline: "asc" },
      take: 6,
    }),
  ]);

  const nudges: ProactiveNudge[] = [];

  // 1. Upcoming interview/exam within 72h missing an InterviewBrief
  const timedSlots: { appId: string; label: string; startMs: number }[] = [];
  let offerCount = 0;
  const offerCompanies: string[] = [];
  let stalest: { id: string; company: string; title: string; stage: string; days: number } | null = null;

  for (const app of applications) {
    if (app.currentStage === "OFFER") {
      offerCount++;
      offerCompanies.push(app.company.name);
    }
    if (isTerminalStage(app.currentStage)) continue;

    const daysStale = Math.floor((nowMs - app.currentStageDate.getTime()) / 86_400_000);
    if (daysStale >= 12 && (!stalest || daysStale > stalest.days)) {
      stalest = {
        id: app.id,
        company: app.company.name,
        title: app.title,
        stage: app.currentStageLabel || STAGE_LABELS[app.currentStage],
        days: daysStale,
      };
    }

    for (const st of app.stageHistory) {
      if (!st.nextDeadline) continue;
      const ms = st.nextDeadline.getTime();
      if (ms < nowMs - 3_600_000 || ms > in7d.getTime()) continue;
      const stageName = st.stageLabel || STAGE_LABELS[st.stage];
      if (st.nextHasTime) {
        timedSlots.push({ appId: app.id, label: `${app.company.name} · ${stageName}`, startMs: ms });
      }
      if (ms <= in72h.getTime() && PREP_STAGES.has(st.stage) && !app.interviewBrief) {
        const hours = Math.max(1, Math.round((ms - nowMs) / 3_600_000));
        const isExam = st.stage === "OA" || st.stage === "ASSESSMENT";
        nudges.push({
          id: `prep:${app.id}`,
          kind: "interview_prep",
          urgency: "high",
          title: `${app.company.name} · ${stageName}（约 ${hours} 小时后）`,
          detail: `尚未生成针对性${isExam ? "笔试" : "面试"}备战速览卡，可结合 JD、简历与真题一键生成。`,
          ctaLabel: isExam ? "一键生成笔试速览" : "一键生成面试速览",
          action: { kind: "generate_brief", applicationId: app.id },
          href: `/applications/${app.id}`,
        });
      }
    }
  }

  // 2. Schedule conflict check (< 90 minutes between two timed events in the next 7 days)
  timedSlots.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < timedSlots.length - 1; i++) {
    const a = timedSlots[i];
    const b = timedSlots[i + 1];
    if (a.appId === b.appId) continue;
    const gapMin = Math.round((b.startMs - a.startMs) / 60_000);
    if (gapMin < 90) {
      nudges.push({
        id: `conflict:${a.appId}:${b.appId}`,
        kind: "schedule_conflict",
        urgency: "high",
        title: `日程撞车预警：${a.label} 与 ${b.label}`,
        detail: gapMin <= 0 ? "两场安排时间重叠，建议尽快联系其中一方协调改期。" : `两场安排仅间隔 ${gapMin} 分钟，容易超时或来不及切换。`,
        ctaLabel: "让小欧拟改期话术",
        action: {
          kind: "ask_xiaoou",
          prompt: `我的「${a.label}」和「${b.label}」时间太近（间隔 ${gapMin} 分钟），帮我看看先改哪场更合适，并给我一版礼貌发给 HR 的改期话术。`,
          mode: "general",
          send: true,
        },
        href: "/calendar",
      });
      break;
    }
  }

  // 3. Multi-offer decision nudge
  if (offerCount >= 2) {
    nudges.push({
      id: `offers:${offerCount}`,
      kind: "offer_decision",
      urgency: "medium",
      title: `手上已有 ${offerCount} 个 Offer 待权衡`,
      detail: `${offerCompanies.slice(0, 3).join("、")}${offerCompanies.length > 3 ? " 等" : ""} 可直接做总包/时薪/通勤/成长性量化对比。`,
      ctaLabel: "进入 Offer 量化决策",
      action: {
        kind: "ask_xiaoou",
        prompt: "帮我量化对比手上所有的 Offer（薪资结构、折算时薪、通勤、加班与成长性），给出明确排序建议。",
        mode: "offer_coach",
        send: true,
      },
      href: "/compare",
    });
  }

  // 4. Expiring high-priority candidate position within 72h
  if (expiringPositions.length > 0) {
    const top = [...expiringPositions].sort(
      (a, b) => (b.positionMatches[0]?.matchScore ?? 0) - (a.positionMatches[0]?.matchScore ?? 0)
    )[0];
    const hours = Math.max(1, Math.round(((top.deadline?.getTime() ?? nowMs) - nowMs) / 3_600_000));
    const score = top.positionMatches[0]?.matchScore;
    nudges.push({
      id: `deadline:${top.id}`,
      kind: "deadline_soon",
      urgency: hours <= 24 ? "high" : "medium",
      title: `网申快截止：${top.company.name} · ${top.title}`,
      detail: `距离截止约 ${hours <= 24 ? `${hours} 小时` : `${Math.ceil(hours / 24)} 天`}${score != null ? `（匹配度 ${score}）` : ""}，还没投递。`,
      ctaLabel: "去准备投递",
      action: {
        kind: "ask_xiaoou",
        prompt: `候选池里的「${top.company.name} · ${top.title}」快截止了，帮我检查一下投递准备和网申入口。`,
        mode: "general",
        send: true,
      },
      href: "/pool",
    });
  }

  // 5. Stale application follow-up nudge
  if (stalest) {
    nudges.push({
      id: `stale:${stalest.id}`,
      kind: "stale_followup",
      urgency: "low",
      title: `久未更新：${stalest.company} · ${stalest.title}`,
      detail: `停留在「${stalest.stage}」已 ${stalest.days} 天，建议发一条得体的进度跟进消息或评估是否调整精力。`,
      ctaLabel: "拟跟进话术",
      action: {
        kind: "ask_xiaoou",
        prompt: `我的「${stalest.company} · ${stalest.title}」（[投递ID:${stalest.id}]）在「${stalest.stage}」已经停滞 ${stalest.days} 天没消息了，帮我判断是否值得催进度，并写一版简短得体的跟进话术。`,
        mode: "general",
        send: true,
      },
      href: `/applications/${stalest.id}`,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return nudges.sort((a, b) => rank[a.urgency] - rank[b.urgency]).slice(0, 4);
}
