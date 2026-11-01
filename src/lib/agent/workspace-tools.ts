import { db } from "@/lib/db";
import { applicationCities } from "@/lib/application-city";
import { APPLICATION_FILTERS, FILTER_LABELS, furthestInterview, interviewBreakdown, matchesFilter, type ApplicationFilter } from "@/lib/application-filters";
import { industryLabel } from "@/lib/company-industry";
import { currentStageRow, isTerminalStage, stepView } from "@/lib/interview-schedule";
import { pendingMailRows } from "@/lib/pending-mail";
import { STAGE_LABELS } from "@/lib/stage-labels";
import type { ApplicationStage } from "@prisma/client";

const MAX_ROWS = 40;

function ymd(date: Date | null | undefined) {
  return date ? date.toLocaleDateString("sv-SE") : null;
}

export type FilterApplicationsArgs = {
  filter?: string;
  stage?: string;
  city?: string;
  industry?: string;
  company?: string;
};

/**
 * Queries the user's entire application table by filter, stage/interview round,
 * city (including inferred cities), industry, or company name/alias.
 */
export async function filterApplicationsTool(userId: string, args: FilterApplicationsArgs) {
  const now = Date.now();
  const rows = await db.application.findMany({
    where: { userId },
    include: {
      company: { include: { aliases: { select: { alias: true } } } },
      position: { select: { location: true } },
      stageHistory: {
        orderBy: { enteredAt: "asc" },
        select: { id: true, stage: true, stageLabel: true, enteredAt: true, nextDeadline: true, nextDeadlineEnd: true, nextHasTime: true, completedAt: true, followedUpAt: true, terminatedAtStageLabel: true },
      },
    },
    orderBy: { appliedDate: "desc" },
  });

  const enriched = rows.map((app) => {
    const cities = applicationCities({ city: app.city, location: app.position?.location, title: app.title, companyName: app.company.name });
    const current = currentStageRow(app, app.stageHistory);
    const step = current && !isTerminalStage(app.currentStage) ? stepView(current, now) : null;
    const interviewReach = furthestInterview(app.currentStage, app.stageHistory);
    return {
      app,
      cities,
      industry: industryLabel(app.company),
      current,
      step,
      waiting: step?.phase === "waiting",
      interviewReach,
      daysSinceUpdate: Math.max(0, Math.floor((now - app.currentStageDate.getTime()) / 86_400_000)),
    };
  });

  const filterKey = (args.filter ?? "all").trim();
  const stageKey = (args.stage ?? "").trim().toUpperCase();
  const cityKey = (args.city ?? "").trim();
  const industryKey = (args.industry ?? "").trim();
  const companyKey = (args.company ?? "").trim().toLowerCase();

  const matched = enriched.filter((item) => {
    const { app, cities, industry, waiting, interviewReach } = item;
    if (filterKey === "missing_city") {
      if (cities.length > 0) return false;
    } else if (filterKey === "guessed_city") {
      if (app.citySource !== "公司所在地") return false;
    } else if ((APPLICATION_FILTERS as readonly string[]).includes(filterKey) && filterKey !== "all") {
      if (!matchesFilter({ currentStage: app.currentStage, currentStageDate: app.currentStageDate, waiting, interviewReach }, filterKey as ApplicationFilter, now)) return false;
    }
    if (stageKey) {
      if (filterKey === "interviewed") {
        if (interviewReach !== stageKey) return false;
      } else if (app.currentStage !== stageKey && interviewReach !== stageKey) {
        return false;
      }
    }
    if (cityKey && !cities.some((c) => c.includes(cityKey))) return false;
    if (industryKey && !industry.includes(industryKey) && !(app.company.industry ?? "").includes(industryKey) && !(app.company.sector ?? "").includes(industryKey)) return false;
    if (companyKey) {
      const names = [app.company.name, ...app.company.aliases.map((a) => a.alias), app.title].map((s) => s.toLowerCase());
      if (!names.some((n) => n.includes(companyKey))) return false;
    }
    return true;
  });

  const shown = matched.slice(0, MAX_ROWS);
  const lines = shown.map(({ app, cities, industry, current, step, interviewReach, daysSinceUpdate }) => {
    const cityPart = cities.length ? `${cities.join("、")}${app.citySource === "公司所在地" ? "（推测）" : ""}` : "未标城市";
    const stagePart = `${STAGE_LABELS[app.currentStage]}${app.currentStageLabel ? `（${app.currentStageLabel}）` : ""}`;
    const reachPart = interviewReach && interviewReach !== app.currentStage ? `；曾面到：${STAGE_LABELS[interviewReach]}` : "";
    const stepPart = step && step.phase !== "open" ? `；${step.text}` : "";
    const offerPart = app.salaryMin || app.salaryMax || app.offerAnnualTotal
      ? `；薪资：${app.salaryMin || app.salaryMax ? `${app.salaryMin ?? "?"}-${app.salaryMax ?? "?"}K` : ""}${app.offerAnnualTotal ? `（总包${app.offerAnnualTotal}万）` : ""}`
      : "";
    return `- [投递ID:${app.id}]${current ? `[进度ID:${current.id}]` : ""} ${app.company.name} · ${app.title}；阶段：${stagePart}${reachPart}${stepPart}；城市：${cityPart}；行业：${industry}；投递：${ymd(app.appliedDate)}（${daysSinceUpdate}天未更新）${offerPart}`;
  });

  const filterDesc = [
    filterKey !== "all" ? (FILTER_LABELS[filterKey as ApplicationFilter] ?? filterKey) : "",
    stageKey ? STAGE_LABELS[stageKey as ApplicationStage] ?? stageKey : "",
    cityKey ? `城市含「${cityKey}」` : "",
    industryKey ? `行业含「${industryKey}」` : "",
    companyKey ? `公司/岗位含「${args.company}」` : "",
  ].filter(Boolean).join(" + ") || "全部投递";

  return {
    content: `筛选条件（${filterDesc}）共匹配 ${matched.length} 条投递${matched.length > shown.length ? `（显示前 ${shown.length} 条）` : ""}：\n${lines.join("\n") || "（没有匹配的投递记录）"}`,
    summary: `${filterDesc}：找到 ${matched.length} 条投递`,
    href: "/applications",
  };
}

export async function getWorkspaceOverviewTool(userId: string, section: string) {
  const kind = (section || "all").trim().toLowerCase();
  const now = Date.now();
  const blocks: string[] = [];

  if (kind === "offers" || kind === "all") {
    const apps = await db.application.findMany({
      where: {
        userId,
        OR: [
          { currentStage: { in: ["OFFER", "ACCEPTED", "DECLINED"] } },
          { salaryMin: { not: null } },
          { salaryMax: { not: null } },
          { offerAnnualTotal: { not: null } },
          { offerNote: { not: null } },
        ],
      },
      include: { company: true, position: { select: { location: true } } },
      orderBy: { updatedAt: "desc" } as never,
    }).catch(() =>
      db.application.findMany({
        where: {
          userId,
          OR: [
            { currentStage: { in: ["OFFER", "ACCEPTED", "DECLINED"] } },
            { salaryMin: { not: null } },
            { salaryMax: { not: null } },
            { offerAnnualTotal: { not: null } },
            { offerNote: { not: null } },
          ],
        },
        include: { company: true, position: { select: { location: true } } },
        orderBy: { appliedDate: "desc" },
      })
    );
    const lines = apps.map((app) => {
      const cities = applicationCities({ city: app.city, location: app.position?.location, title: app.title, companyName: app.company.name });
      const parts = [
        `状态：${STAGE_LABELS[app.currentStage]}`,
        cities.length ? `城市：${cities.join("、")}` : null,
        app.salaryMin || app.salaryMax ? `月薪：${app.salaryMin ?? "?"}-${app.salaryMax ?? "?"}K` : null,
        app.offerAnnualTotal ? `年总包：${app.offerAnnualTotal}万` : null,
        app.commuteMinutes != null ? `单程通勤：${app.commuteMinutes}分钟` : null,
        app.overtimeNote ? `加班强度：${app.overtimeNote}` : null,
        app.growthNote ? `成长与团队：${app.growthNote}` : null,
        app.offerNote ? `薪资备注：${app.offerNote}` : null,
      ].filter(Boolean);
      return `- [投递ID:${app.id}] ${app.company.name} · ${app.title}；${parts.join("；")}`;
    });
    blocks.push(`### Offer 与薪资对比（共 ${apps.length} 条，可用 update_offer 更新薪资/年包/通勤/加班/备注）\n${lines.join("\n") || "（暂无 Offer 或薪资记录）"}`);
  }

  if (kind === "interviews" || kind === "all") {
    const [apps, notes, intel] = await Promise.all([
      db.application.findMany({
        where: { userId },
        select: { id: true, currentStage: true, stageHistory: { select: { stage: true } } },
      }),
      db.stageHistory.findMany({
        where: {
          application: { userId },
          OR: [{ note: { not: null } }, { interviewer: { not: null } }, { interviewFormat: { not: null } }],
        },
        include: { application: { select: { id: true, title: true, company: { select: { name: true } } } }, postmortem: { select: { content: true } } },
        orderBy: { enteredAt: "desc" },
        take: 15,
      }),
      db.interviewIntelligence.findUnique({ where: { userId }, select: { result: true } }).catch(() => null),
    ]);
    const breakdown = interviewBreakdown(
      apps.map((a) => ({ currentStage: a.currentStage, interviewReach: furthestInterview(a.currentStage, a.stageHistory) }))
    );
    const tableLines = breakdown.rows.map(
      (r) => `${r.label}：合计 ${r.total}（还在面/等结果 ${r.cells.going ?? 0}，没过 ${r.cells.failed ?? 0}，Offer ${r.cells.offer ?? 0}）`
    );
    const noteLines = notes.map((row) => {
      const text = (row.note ?? "").replace(/\s+/g, " ").slice(0, 260);
      return `- [进度ID:${row.id}][投递ID:${row.application.id}] ${row.application.company.name} · ${row.application.title}（${ row.stageLabel || STAGE_LABELS[row.stage] }，${ymd(row.enteredAt)}）${row.interviewFormat ? ` [${row.interviewFormat}]` : ""}${row.interviewer ? ` 面试官:${row.interviewer}` : ""}：${text || "（无正文）"}`;
    });
    blocks.push(
      `### 面试统计与面经复盘\n进过面试共 ${breakdown.total} 条：\n${tableLines.join("\n")}\n\n最近记录的面经/备注（共展示 ${noteLines.length} 条）：\n${noteLines.join("\n") || "（暂无面经记录）"}${intel?.result ? `\n\n面试能力分析摘要：${JSON.stringify(intel.result).slice(0, 800)}` : ""}`
    );
  }

  if (kind === "calendar" || kind === "all") {
    const [events, mailTasks, scheduledStages] = await Promise.all([
      db.calendarEvent.findMany({
        where: { userId, stageHistoryId: null, completedAt: null, startsAt: { gte: new Date(now - 7 * 86_400_000) } },
        orderBy: { startsAt: "asc" },
        take: 25,
      }),
      db.personalTask.findMany({
        where: { userId, done: false, sourceMailKey: { not: null }, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      db.stageHistory.findMany({
        where: { application: { userId }, nextDeadline: { gte: new Date(now) }, completedAt: null },
        select: { applicationId: true },
      }),
    ]);
    const scheduledApps = new Set(scheduledStages.map((s) => s.applicationId));
    const pendingMail = pendingMailRows(mailTasks, now, scheduledApps);
    const eventLines = events.map(
      (e) => `- [日程ID:${e.id}] ${e.title}：${e.allDay ? e.dateKey : e.startsAt.toLocaleString("zh-CN")}${e.meetingInfo ? `；链接/备注：${e.meetingInfo.slice(0, 120)}` : ""}`
    );
    const mailLines = pendingMail.map(
      (m) => `- [邮件待办ID:${m.id}] ${m.company ? `${m.company} · ` : ""}${m.type}（${m.summary}）${m.time ? `；识别时间：${new Date(m.time.startsAt).toLocaleString("zh-CN")}` : m.waiting ? "；时间另行通知" : "；未写出具体时间"}`
    );
    blocks.push(
      `### 独立日历事项与待确认邮件日程\n独立日历事项（未完成）：\n${eventLines.join("\n") || "（无）"}\n\n邮件里识别到、还没进日历的安排（可用 complete_calendar_event 确认写入日历，或用 set_schedule 记到投递上）：\n${mailLines.join("\n") || "（无）"}`
    );
  }

  if (kind === "profile" || kind === "all") {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, phone: true, contactEmail: true, school: true, graduationYear: true, targetTrack: true, preferredCities: true, expectedSalaryMin: true, skills: true, applicationProfile: true },
    });
    const appProfile = (user?.applicationProfile ?? {}) as Record<string, unknown>;
    const summary = {
      school: user?.school,
      graduationYear: user?.graduationYear,
      targetTrack: user?.targetTrack,
      preferredCities: user?.preferredCities,
      expectedSalaryMin: user?.expectedSalaryMin ? `${user.expectedSalaryMin}K` : null,
      skills: user?.skills,
      educationCount: Array.isArray(appProfile.education) ? appProfile.education.length : 0,
      experienceCount: Array.isArray(appProfile.experiences) ? appProfile.experiences.length : 0,
      projectCount: Array.isArray(appProfile.projects) ? appProfile.projects.length : 0,
      awardCount: Array.isArray(appProfile.awards) ? appProfile.awards.length : 0,
      education: Array.isArray(appProfile.education) ? appProfile.education.slice(0, 4) : [],
      experiences: Array.isArray(appProfile.experiences) ? appProfile.experiences.slice(0, 4) : [],
      projects: Array.isArray(appProfile.projects) ? appProfile.projects.slice(0, 4) : [],
    };
    blocks.push(`### 求职偏好与网申资料（可用 update_profile 修改方向/城市/期望薪资/技能）\n${JSON.stringify(summary)}`);
  }

  if (kind === "contacts" || kind === "all") {
    const contacts = await db.contact.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const lines = contacts.map(
      (c) => `- [联系人ID:${c.id}] ${c.name}${c.role ? `（${c.role}）` : ""}${c.companyName ? ` · ${c.companyName}` : ""}${c.contactInfo ? `；联系方式：${c.contactInfo}` : ""}${c.note ? `；备注：${c.note}` : ""}${c.nextFollowUpAt ? `；下次跟进：${ymd(c.nextFollowUpAt)}` : ""}`
    );
    blocks.push(`### 联系人名录（共 ${contacts.length} 人）\n${lines.join("\n") || "（暂无联系人）"}`);
  }

  if (kind === "journey" || kind === "all") {
    const entries = await db.journeyEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    const lines = entries.map(
      (e) => `- [${ymd(e.createdAt)} 心情:${e.mood}${e.about ? ` · ${e.about}` : ""}] ${e.text.slice(0, 200)}`
    );
    blocks.push(`### 心路历程（最近 ${entries.length} 条，可用 add_journey 帮用户记录感悟）\n${lines.join("\n") || "（暂无记录）"}`);
  }

  return {
    content: blocks.join("\n\n") || "没有找到对应模块的数据",
    summary: `读取了「${kind}」模块数据`,
  };
}
