import { db } from "@/lib/db";
import { extractProfileSignal, scorePostingMatch } from "@/lib/posting-match";
import { expandQueryTerms, scoreTextMatch } from "@/lib/agent/semantic-search";

export type CareerOpsGrade = "S" | "A" | "B" | "C" | "D" | "F";

export type EvaluatedPosition = {
  positionId: string;
  company: string;
  title: string;
  location: string;
  status: string;
  deadline: string | null;
  applyUrl: string | null;
  totalScore: number;
  grade: CareerOpsGrade;
  dimensions: {
    roleFit: number; // /25
    skillCoverage: number; // /25
    locationFit: number; // /15
    compFit: number; // /10
    readiness: number; // /15
    riskSafety: number; // /10
  };
  strengths: string[];
  gaps: string[];
  recommendation: "立刻投递" | "计划投递" | "观望评估" | "建议放弃";
};

function gradeFromScore(score: number): CareerOpsGrade {
  if (score >= 85) return "S";
  if (score >= 74) return "A";
  if (score >= 62) return "B";
  if (score >= 50) return "C";
  if (score >= 38) return "D";
  return "F";
}

function recommendationFromGrade(grade: CareerOpsGrade): EvaluatedPosition["recommendation"] {
  if (grade === "S") return "立刻投递";
  if (grade === "A") return "计划投递";
  if (grade === "B" || grade === "C") return "观望评估";
  return "建议放弃";
}

function normalizeUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * CareerOps 6-dimension batch position evaluator.
 * Deterministically grades up to 12 candidate positions (S/A/B/C/D/F) against the
 * applicant's target track, skills, default resume text, preferred cities, salary
 * floor, deadline urgency, and hard-requirement risk signals.
 */
export async function batchEvaluateJobsTool(
  userId: string,
  args: { positionIds?: string[]; limit?: number; onlyUnapplied?: boolean } = {},
  now = new Date()
) {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 12);
  const onlyUnapplied = args.onlyUnapplied !== false;
  const requestedIds = Array.isArray(args.positionIds)
    ? args.positionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).slice(0, 12)
    : [];

  const [user, defaultResume, positions] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        targetTrack: true,
        preferredCities: true,
        skills: true,
        expectedSalaryMin: true,
        graduationYear: true,
      },
    }),
    db.resumeVersion.findFirst({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, extractedText: true, targetTrack: true },
    }),
    db.position.findMany({
      where: {
        userId,
        ...(requestedIds.length
          ? { id: { in: requestedIds } }
          : onlyUnapplied
            ? { status: { in: ["EVALUATING", "PLANNED"] } }
            : {}),
      },
      include: {
        company: { select: { name: true, careerUrl: true, industry: true } },
        positionMatches: { orderBy: { updatedAt: "desc" }, take: 1, select: { matchScore: true, recommendation: true } },
      },
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: limit,
    }),
  ]);

  if (!positions.length) {
    return {
      evaluated: [] as EvaluatedPosition[],
      content: "候选岗位池里目前没有待评估的岗位。可以先用 find_jobs 或 web_search 找一批岗位加进候选池。",
      summary: "暂无待评估岗位",
      href: "/pool",
    };
  }

  const profileSignal = extractProfileSignal({
    targetTrack: user?.targetTrack ?? defaultResume?.targetTrack ?? null,
    preferredCities: user?.preferredCities ?? null,
    skills: [user?.skills, defaultResume?.extractedText?.slice(0, 600)].filter(Boolean).join(" ") || null,
    graduationYear: user?.graduationYear ?? null,
  });

  const skillTokens = `${user?.skills ?? ""}`
    .split(/[\s,，、/|;；]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 20);
  const trackGroups = user?.targetTrack ? expandQueryTerms(user.targetTrack) : [];
  const prefCities = (user?.preferredCities ?? "")
    .split(/[\s,，、/|]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const nowMs = now.getTime();

  const evaluated: EvaluatedPosition[] = positions.map((pos) => {
    const jd = (pos.jdText ?? "").trim();
    const combinedText = `${pos.company.name} ${pos.title} ${pos.track ?? ""} ${pos.company.industry ?? ""} ${jd}`;
    const strengths: string[] = [];
    const gaps: string[] = [];

    // 1. Role fit (/25)
    const postingMatch = scorePostingMatch(
      {
        companyName: pos.company.name,
        title: pos.title,
        tracks: pos.track ?? null,
        cities: pos.location ?? null,
        industry: pos.company.industry ?? null,
        description: jd.slice(0, 1200) || null,
      },
      profileSignal
    );
    const trackScore = trackGroups.length ? scoreTextMatch(combinedText, trackGroups) : 0;
    const aiMatch = pos.positionMatches[0]?.matchScore ?? null;
    let roleFit = Math.min(25, Math.round((postingMatch.score / 100) * 18) + (trackScore >= 5 ? 7 : trackScore > 0 ? 4 : 0));
    if (aiMatch != null) {
      roleFit = Math.min(25, Math.round(roleFit * 0.4 + (aiMatch / 100) * 25 * 0.6));
      strengths.push(`已有 AI 匹配分 ${aiMatch}`);
    } else if (trackScore >= 5) {
      strengths.push("岗位方向与目标赛道高度吻合");
    } else if (trackGroups.length && trackScore === 0) {
      gaps.push("岗位方向与目标赛道偏离");
    }

    // 2. Skill coverage (/25)
    let skillCoverage = 12;
    if (skillTokens.length > 0 && combinedText.length > 20) {
      const lower = combinedText.toLowerCase();
      const matchedSkills = skillTokens.filter((sk) => lower.includes(sk.toLowerCase()));
      const ratio = matchedSkills.length / Math.min(skillTokens.length, 8);
      skillCoverage = Math.min(25, Math.round(6 + Math.min(1, ratio) * 19));
      if (matchedSkills.length >= 2) strengths.push(`命中技能：${matchedSkills.slice(0, 4).join("/")}`);
      else if (jd.length > 100 && matchedSkills.length === 0) gaps.push("JD 与当前技能栈关键词重合偏低");
    } else if (!jd) {
      skillCoverage = 10;
      gaps.push("尚未补充 JD 正文，建议打开原页抓全");
    }

    // 3. Location fit (/15)
    let locationFit = 10;
    const loc = (pos.location ?? "").trim();
    if (prefCities.length && loc) {
      if (prefCities.some((c) => loc.includes(c))) {
        locationFit = 15;
        strengths.push(`地点匹配（${loc}）`);
      } else {
        locationFit = 4;
        gaps.push(`工作地点「${loc}」不在意向城市内`);
      }
    } else if (!loc) {
      locationFit = 8;
    }

    // 4. Comp fit (/10)
    let compFit = 6;
    if (user?.expectedSalaryMin && (pos.salaryMax || pos.salaryMin)) {
      const top = pos.salaryMax ?? pos.salaryMin ?? 0;
      if (top >= user.expectedSalaryMin) {
        compFit = 10;
        strengths.push(`薪资达预期（${pos.salaryMin ?? "?"}-${pos.salaryMax ?? "?"}K）`);
      } else if (top >= user.expectedSalaryMin * 0.85) {
        compFit = 7;
      } else {
        compFit = 2;
        gaps.push(`标明薪资（${pos.salaryMin ?? "?"}-${pos.salaryMax ?? "?"}K）低于期望 ${user.expectedSalaryMin}K`);
      }
    }

    // 5. Readiness & deadline urgency (/15)
    const applyUrl = normalizeUrl(pos.jdUrl) ?? normalizeUrl(pos.company.careerUrl);
    let readiness = applyUrl ? 9 : 4;
    if (!applyUrl) gaps.push("缺少直达网申链接");
    let deadlineStr: string | null = null;
    if (pos.deadline) {
      deadlineStr = pos.deadline.toLocaleDateString("sv-SE");
      const daysLeft = Math.ceil((pos.deadline.getTime() - nowMs) / 86_400_000);
      if (daysLeft < 0) {
        readiness = 1;
        gaps.push(`已过截止日（${deadlineStr}）`);
      } else if (daysLeft <= 5) {
        readiness = Math.min(15, readiness + 6);
        strengths.push(`临近截止（剩 ${daysLeft} 天），需优先投`);
      } else {
        readiness = Math.min(15, readiness + 4);
      }
    } else {
      readiness = Math.min(15, readiness + 3);
    }

    // 6. Hard-requirement / risk safety (/10)
    let riskSafety = 10;
    if (jd) {
      if (/仅限博士|必须博士|博士学历/.test(jd)) {
        riskSafety -= 4;
        gaps.push("JD 含博士硬性门槛提示");
      }
      if (/3年以上|5年以上|社招经验/.test(jd) && !/应届|校招|实习/.test(jd)) {
        riskSafety -= 4;
        gaps.push("疑似偏社招经验要求");
      }
      if (user?.graduationYear) {
        const yearMatches = jd.match(/20\d{2}\s*届/g) ?? [];
        const hasMyYear = yearMatches.some((m) => m.includes(String(user.graduationYear)));
        if (yearMatches.length > 0 && !hasMyYear) {
          riskSafety -= 4;
          gaps.push(`届别要求（${yearMatches.slice(0, 2).join("/")}）与你的 ${user.graduationYear} 届不符`);
        }
      }
    } else {
      riskSafety = 7;
    }
    riskSafety = Math.max(0, riskSafety);

    const totalScore = Math.max(0, Math.min(100, roleFit + skillCoverage + locationFit + compFit + readiness + riskSafety));
    const grade = gradeFromScore(totalScore);
    return {
      positionId: pos.id,
      company: pos.company.name,
      title: pos.title,
      location: loc || "未标",
      status: pos.status,
      deadline: deadlineStr,
      applyUrl,
      totalScore,
      grade,
      dimensions: { roleFit, skillCoverage, locationFit, compFit, readiness, riskSafety },
      strengths: strengths.slice(0, 3),
      gaps: gaps.slice(0, 3),
      recommendation: recommendationFromGrade(grade),
    };
  });

  evaluated.sort((a, b) => b.totalScore - a.totalScore);

  const lines = evaluated.map((e, i) => {
    const d = e.dimensions;
    return `${i + 1}. **[${e.grade}级 · ${e.totalScore}分 · ${e.recommendation}]** [岗位ID:${e.positionId}] ${e.company} · ${e.title}（${e.location}${e.deadline ? `，截止 ${e.deadline}` : ""}）\n` +
      `   - 6维打分：方向 ${d.roleFit}/25 | 技能 ${d.skillCoverage}/25 | 地点 ${d.locationFit}/15 | 薪资 ${d.compFit}/10 | 投递就绪 ${d.readiness}/15 | 门槛安全 ${d.riskSafety}/10\n` +
      `   - 亮点：${e.strengths.join("；") || "常规匹配"}\n` +
      `   - 风险/缺口：${e.gaps.join("；") || "无明显硬伤"}${e.applyUrl ? `\n   - 网申入口：${e.applyUrl}` : ""}`;
  });

  const topIds = evaluated.filter((e) => (e.grade === "S" || e.grade === "A") && e.applyUrl).map((e) => e.positionId);

  return {
    evaluated,
    content:
      `已完成 CareerOps 6 维度批量评估（共 ${evaluated.length} 个候选岗位，参考简历：${defaultResume?.name ?? "未设置"}）：\n\n` +
      lines.join("\n\n") +
      `\n\n（操作提示：你可以用 Markdown 表格向用户展示 A-F 评级结果；对 S/A 级岗位，可通过 propose_actions 给出 update_position(PLANNED)、tailor_resume_pdf 一键定制简历、或 launch_batch_apply${topIds.length ? `（targetId="${topIds.slice(0, 8).join(",")}"）` : ""} 一键送入网申浏览器批量预填；对 D/F 级可提 update_position(DROPPED)。）`,
    summary: `批量评估 ${evaluated.length} 个岗位：S/A 级 ${evaluated.filter((e) => e.grade === "S" || e.grade === "A").length} 个`,
    href: "/pool",
  };
}
