import { db } from "@/lib/db";
import { buildTodos } from "@/lib/todos";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { applicationStageValues } from "@/lib/validation";
import { loadUpcomingSchedule } from "@/lib/schedule-loader";
import { SCHEDULE_KIND_LABELS, currentStageRow, extractMeetingUrl, isTerminalStage, relativeText, stepView, whenText } from "@/lib/interview-schedule";

// What 小欧 knows about the user's search at the start of every turn: a
// bounded snapshot of the pool, 投递, schedule, leads, to-dos and contacts,
// each row with the ID its tools and proposed actions refer to. A plain
// server module (not "use server") so the agent route and actions share it.

// Keep the prompt bounded — a pool/application list that's grown large over
// a whole job-search season shouldn't blow up every single chat turn's cost.
const MAX_ITEMS = 25;
export const MAX_HISTORY_TURNS = 8;
// Positions/applications/leads are summarized to counts + this many
// highlighted rows (still carrying real IDs) rather than dumped in full —
// see buildSnapshot's comment above the highlight logic for why.
const MAX_HIGHLIGHTS = 8;
const MAX_LEAD_HIGHLIGHTS = 5;

/**
 * Local-time YYYY-MM-DD. Deliberately not toISOString().slice(0,10), which
 * renders UTC: at UTC+8 that reports the previous day for any moment before
 * 08:00 local, so "今天是 …" and every deadline in the snapshot came out one
 * day early all morning — and the assistant then reasons about urgency off
 * that wrong date.
 */
function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function buildSnapshot(userId: string): Promise<string> {
  const [
    profile,
    positions,
    positionCount,
    applications,
    applicationCount,
    positionMatches,
    stageHistories,
    personalTasks,
    resumeVersions,
    leads,
    leadCount,
    contacts,
  ] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          school: true,
          targetTrack: true,
          graduationYear: true,
          skills: true,
          preferredCities: true,
          expectedSalaryMin: true,
        },
      }),
      db.position.findMany({
        where: { userId },
        include: { company: true },
        orderBy: { createdAt: "desc" },
        take: MAX_ITEMS,
      }),
      db.position.count({ where: { userId } }),
      db.application.findMany({
        where: { userId },
        include: { company: true, stageHistory: { orderBy: { enteredAt: "desc" }, take: 8, select: { stage: true, terminatedAtStage: true, terminatedAtStageLabel: true } } },
        orderBy: { appliedDate: "desc" },
        take: MAX_ITEMS,
      }),
      db.application.count({ where: { userId } }),
      // Only the two fields the highlight logic below needs to rank and
      // annotate positions — a full PositionMatch.result breakdown would be
      // exactly the kind of per-record bulk this summary is trying to avoid.
      db.positionMatch.findMany({
        where: { userId },
        select: { positionId: true, matchScore: true, recommendation: true },
      }),
      db.stageHistory.findMany({
        where: { application: { userId }, nextDeadline: { not: null } },
        include: { application: { include: { company: true } } },
      }),
      db.personalTask.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      db.resumeVersion.findMany({
        where: { userId },
        select: { id: true, name: true, targetTrack: true, checkScore: true, isDefault: true },
        orderBy: { createdAt: "desc" },
      }),
      // Only leads not already promoted into the pool — a promoted one shows
      // up under 候选岗位池 below, and listing it twice invites the assistant
      // to recommend adding something that's already there.
      db.jobLead.findMany({
        where: { userId, promotedPositionId: null },
        // Highest resume-match first, then soonest deadline: those are the
        // two things that actually decide what to apply to next.
        orderBy: [{ fitScore: "desc" }, { deadline: "asc" }],
        take: MAX_LEAD_HIGHLIGHTS,
      }),
      db.jobLead.count({ where: { userId, promotedPositionId: null } }),
      db.contact.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_ITEMS }),
    ]);

  const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts);

  const sections: string[] = [];

  // Users say "下周三" / "这周五" constantly, and models are measurably bad
  // at the arithmetic — Qwen turned "下周五" into a Sunday and "周三" into a
  // Friday even when told today's date and weekday. Weekday arithmetic is
  // trivial to do exactly here, so do it here: spelling out the next two
  // weeks turns the conversion into a lookup instead of a calculation.
  const now = new Date();
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const label = i === 0 ? "今天" : i === 1 ? "明天" : i === 2 ? "后天" : "";
    return `${ymd(d)} 星期${"日一二三四五六"[d.getDay()]}${label ? `（${label}）` : ""}`;
  });
  sections.push(
    `日期对照（相对日期一律查这张表，不要自己推算）：\n${calendar.join("\n")}\n` +
      `"这周X"指本周内那一天，"下周X"指再往后一周的那一天。`
  );

  if (profile) {
    const bits = [
      profile.school ? `学校：${profile.school}` : null,
      profile.graduationYear ? `毕业年份：${profile.graduationYear}` : null,
      profile.targetTrack ? `目标方向：${profile.targetTrack}` : null,
      profile.skills ? `技能：${profile.skills}` : null,
      profile.preferredCities ? `意向城市：${profile.preferredCities}` : null,
      profile.expectedSalaryMin ? `期望月薪下限：${profile.expectedSalaryMin}K` : null,
    ].filter(Boolean);
    sections.push(
      "求职者本人：\n" + (bits.length === 0 ? "（个人资料没填，判断匹配度时说明这一点）" : bits.join("；"))
    );
  }

  // Positions/applications used to be dumped here in full every single turn
  // regardless of what was actually asked — fine at a few dozen records, but
  // it doesn't scale, and most turns don't need every record's detail
  // anyway. This compacts each into counts + a short highlighted subset
  // (still carrying real IDs, since actions need to reference a specific
  // record without an extra round trip) — search_records is how the model
  // reaches anything outside the highlights.
  const positionMatchByPositionId = new Map(positionMatches.map((m) => [m.positionId, m]));
  const positionStatusCounts = new Map<string, number>();
  for (const p of positions) positionStatusCounts.set(p.status, (positionStatusCounts.get(p.status) ?? 0) + 1);
  const highlightedPositions = positions
    .filter((p) => p.status !== "APPLIED")
    .sort((a, b) => {
      const am = positionMatchByPositionId.get(a.id)?.matchScore ?? -1;
      const bm = positionMatchByPositionId.get(b.id)?.matchScore ?? -1;
      if (am !== bm) return bm - am;
      const ad = a.deadline ? a.deadline.getTime() : Infinity;
      const bd = b.deadline ? b.deadline.getTime() : Infinity;
      return ad - bd;
    })
    .slice(0, MAX_HIGHLIGHTS);

  sections.push(
    `候选岗位池（共 ${positionCount} 个${positionCount > positions.length ? `，本快照只取了最近 ${positions.length} 个算高亮，更早的用 search_records 查` : ""}；${[...positionStatusCounts.entries()].map(([s, n]) => `${s}:${n}`).join("，") || "空"}）：\n` +
      (highlightedPositions.length === 0
        ? "（没有还没投的岗位——完整列表用 search_records 查）"
        : "以下是匹配度最高/截止最近的几个，其余用 search_records 按公司名或关键词查：\n" +
          highlightedPositions
            .map((p) => {
              const match = positionMatchByPositionId.get(p.id);
              const parts = [
                p.track ? `方向：${p.track}` : null,
                p.deadline ? `截止：${ymd(p.deadline)}` : null,
                match ? `AI 匹配度：${match.matchScore}（${match.recommendation}）` : "（还没跑过 AI 匹配）",
                `状态：${p.status}`,
              ].filter(Boolean);
              return `- [岗位ID:${p.id}] ${p.company.name} · ${p.title}；${parts.join("；")}`;
            })
            .join("\n"))
  );

  const applicationStageCounts = new Map<string, number>();
  for (const a of applications) applicationStageCounts.set(a.currentStage, (applicationStageCounts.get(a.currentStage) ?? 0) + 1);
  const nextDeadlineByApplicationId = new Map(
    stageHistories
      .filter((h): h is typeof h & { nextDeadline: Date } => h.nextDeadline !== null)
      .map((h) => [h.application.id, h.nextDeadline])
  );
  const highlightedApplications = applications
    .slice()
    .sort((a, b) => {
      const ad = nextDeadlineByApplicationId.get(a.id)?.getTime() ?? Infinity;
      const bd = nextDeadlineByApplicationId.get(b.id)?.getTime() ?? Infinity;
      if (ad !== bd) return ad - bd;
      return b.appliedDate.getTime() - a.appliedDate.getTime();
    })
    .slice(0, MAX_HIGHLIGHTS);

  sections.push(
    `投递记录（共 ${applicationCount} 条${applicationCount > applications.length ? `，本快照只取了最近 ${applications.length} 条算高亮，更早的用 search_records 查` : ""}；按阶段：${[...applicationStageCounts.entries()].map(([s, n]) => `${STAGE_LABELS[s as keyof typeof STAGE_LABELS]}:${n}`).join("，") || "空"}）：\n` +
      (highlightedApplications.length === 0
        ? "（还没有投递记录）"
        : "以下是有临近下一步/最近更新的几条，其余用 search_records 按公司名查：\n" +
          highlightedApplications
            .map((a) => {
              const nextDeadline = nextDeadlineByApplicationId.get(a.id);
              const parts = [
                `阶段：${STAGE_LABELS[a.currentStage]}`,
                ["REJECTED", "WITHDRAWN", "CANCELLED"].includes(a.currentStage) ? `结束阶段：${a.stageHistory.find(h => h.stage === a.currentStage)?.terminatedAtStageLabel || a.stageHistory.find(h => h.stage === a.currentStage)?.terminatedAtStage || "历史未记录"}` : null,
                `投递日期：${ymd(a.appliedDate)}`,
                nextDeadline ? `下一步：${ymd(nextDeadline)}` : null,
              ].filter(Boolean);
              return `- [投递ID:${a.id}] ${a.company.name} · ${a.title}；${parts.join("；")}`;
            })
            .join("\n"))
  );

  sections.push(await scheduleSection(userId, now));

  sections.push(
    `秋招信息库（导入的岗位线索，还没提到候选池，共 ${leadCount} 条）：\n` +
      (leads.length === 0
        ? "（空——用户可以在「秋招信息库」页面导入群里流传的秋招信息表）"
        : (leadCount > leads.length ? `以下是简历匹配分最高的 ${leads.length} 条，其余用 search_records 查：\n` : "") +
          leads
            .map((l) => {
              const parts = [
                `${l.companyName} · ${l.title}`,
                l.track ? `方向：${l.track}` : null,
                l.location ? `地点：${l.location}` : null,
                l.salaryMin || l.salaryMax ? `薪资：${l.salaryMin ?? "?"}-${l.salaryMax ?? "?"}K` : null,
                l.deadline ? `截止：${ymd(l.deadline)}` : null,
                l.fitScore != null ? `简历匹配分：${l.fitScore}` : null,
              ].filter(Boolean);
              return `- [线索ID:${l.id}] ${parts.join("；")}`;
            })
            .join("\n"))
  );

  sections.push(
    "近期待办/截止日期（按紧急程度排序）：\n" +
      (todos.length === 0
        ? "（没有紧急事项）"
        : todos.map((t) => `- ${t.label}：${t.sublabel}`).join("\n"))
  );

  // Separate from the merged feed above (which has no IDs): complete_task
  // needs to name a specific row, and only undone ones are worth offering.
  const openTasks = personalTasks.filter((t) => !t.done);
  sections.push(
    "自建待办（含ID，只列未完成的）：\n" +
      (openTasks.length === 0
        ? "（没有未完成的待办）"
        : openTasks
            .map((t) => {
              const parts = [
                t.dueDate ? `日期：${ymd(t.dueDate)}` : null,
                t.note ? `备注：${t.note}` : null,
              ].filter(Boolean);
              return `- [待办ID:${t.id}] ${t.title}${parts.length ? "；" + parts.join("；") : ""}`;
            })
            .join("\n"))
  );

  sections.push(
    "联系人（HR/内推人/面试官）：\n" +
      (contacts.length === 0
        ? "（还没记录联系人）"
        : contacts
            .map((c) => {
              const parts = [
                c.role ?? null,
                c.companyName ?? null,
                c.contactInfo ?? null,
                c.nextFollowUpAt ? `下次跟进：${ymd(c.nextFollowUpAt)}` : null,
              ].filter(Boolean);
              return `- [联系人ID:${c.id}] ${c.name}${parts.length ? "；" + parts.join("；") : ""}`;
            })
            .join("\n"))
  );

  sections.push(
    "简历版本：\n" +
      (resumeVersions.length === 0
        ? "（还没上传过简历）"
        : resumeVersions
            .map(
              (r) =>
                `- [简历ID:${r.id}] ${r.name}${r.isDefault ? "（默认）" : ""}${r.targetTrack ? `，方向：${r.targetTrack}` : ""}${r.checkScore != null ? `，AI 体检分：${r.checkScore}` : "，还没做过 AI 体检"}`
            )
            .join("\n"))
  );

  return sections.join("\n\n");
}

/**
 * 接下来 14 天的面试/笔试（时间、会议或测评链接、截止）和每条进行中投递当前
 * 这一轮的状态（等结果、该跟进、截止已过）——带进度ID，小欧才能改期、标记
 * 完成、记面经。
 */
async function scheduleSection(userId: string, now: Date): Promise<string> {
  const nowMs = now.getTime();
  const [upcoming, open] = await Promise.all([
    loadUpcomingSchedule(userId, now, 14),
    db.application.findMany({
      where: { userId },
      select: { id: true, title: true, currentStage: true, currentStageDate: true, company: { select: { name: true } }, stageHistory: { select: { id: true, stage: true, enteredAt: true, nextDeadline: true, nextDeadlineEnd: true, nextHasTime: true, completedAt: true, followedUpAt: true, note: true } } },
    }),
  ]);
  const lines = upcoming.map((item) => {
    const ids = item.source === "stage" ? `[进度ID:${item.sourceId}][投递ID:${item.applicationId}] ` : item.source === "mail" ? "（邮件里识别到、还没确认）" : item.applicationId ? `[投递ID:${item.applicationId}] ` : "";
    const url = extractMeetingUrl(item.meetingInfo);
    const extra = [
      item.meetingInfo ? `会议/备注：${item.meetingInfo.replace(/\s+/g, " ").slice(0, 160)}` : null,
      url ? `${item.kind === "exam" ? "测评链接" : "会议链接"}：${url}` : null,
    ].filter(Boolean);
    return `- ${ids}${[item.companyName, item.jobTitle].filter(Boolean).join(" · ") || "（未关联投递）"} ${SCHEDULE_KIND_LABELS[item.kind]}「${item.title}」：${whenText(item, nowMs)}（${relativeText(item, nowMs)}）${extra.length ? "；" + extra.join("；") : ""}`;
  });
  const waiting: string[] = [];
  for (const app of open) {
    if (isTerminalStage(app.currentStage)) continue;
    const row = currentStageRow(app, app.stageHistory);
    if (!row) continue;
    const view = stepView(row, nowMs);
    if (!view || view.phase === "open") continue;
    waiting.push(`- [进度ID:${row.id}][投递ID:${app.id}] ${app.company.name} · ${app.title}（${STAGE_LABELS[row.stage]}）：${view.text}${row.note ? "；已记复盘" : ""}`);
  }
  return `接下来 14 天的面试/笔试/截止（时间已换算成用户本地时间）：\n${lines.length ? lines.join("\n") : "（没有记下时间的安排）"}\n\n` +
    `面完/考完在等结果、该跟进、或截止已过还没标完成的：\n${waiting.length ? waiting.join("\n") : "（没有）"}`;
}


/** How each proposed change is filled in; the model reads this before proposing. */
export const ACTION_GUIDE = `当用户说的话意味着数据该被记下来或改动时，用 propose_actions 提出建议，用户点一下才会执行。绝不要凭空替他决定——只有他确实表达了这个意思才提。可用的 type：
- add_task：加一条待办。title 填事情，date 填截止日（YYYY-MM-DD），note 可选。如果用户说的是一个时间窗口（比如"笔试 8月26到30号之间随时可以做"），date 填窗口开始，dateEnd 填窗口结束
- log_application：记一条新投递。companyName + title 必填，date 填投递日期（没说就用今天）
- add_position：往候选岗位池里加一个还没投的岗位。companyName + title 必填，date 填截止日期，note 可写方向/地点，url 填岗位链接（find_jobs 找到的岗位一定带上）
- update_stage：更新某条投递的阶段。targetId 填上面的[投递ID]，stage 从这些里选：${applicationStageValues.join(" / ")}，date 填下一步的时间（比如面试时间），note 可选。同样，如果下一步是笔试/测评这种给一段窗口而不是单一时间点的，date 填窗口开始，dateEnd 填窗口结束
- promote_lead：把秋招信息库里的一条线索提进候选岗位池。targetId 填上面的[线索ID]
- add_contact：记一个 HR / 内推人 / 面试官。contactName 填这个人的名字（必填），title 填角色（HR/内推人/面试官等），companyName 可选，note 填联系方式（微信/邮箱/电话）或其他备注，date 填下次该跟进的日期（用户说"过几天再联系他"这类才填，没提就不填）
- mark_position_applied：把候选岗位池里的一个岗位标记为已投递。targetId 填上面"候选岗位池"里对上的 [岗位ID]，date 填投递日期（没说就用今天），note 填渠道（官网/内推/猎头...），contactName 填内推人（没有就不填）。**用户提到的公司+岗位如果能在候选岗位池里对上号，一定用这个而不是 log_application**——这样投递记录和候选池会正确关联、候选池状态也会同步更新；对不上号（候选池里没有这个岗位）才用 log_application 单独记一条
- update_application：修改一条已有投递记录的日期/渠道/内推人。targetId 填上面"投递记录"里对上的 [投递ID]，date/note（渠道）/contactName（内推人）里用户提到哪个改哪个，没提到的字段留空——**留空的字段调用时会自动保留原值，不会被清空**
- delete_position：把候选岗位池里一个不打算投的岗位删掉。targetId 填 [岗位ID]，仅当用户明确说"不投了""删了"这类才提
- withdraw_application：删掉一条投递记录，仅用于记错了且明确要求删除。主动撤回必须使用 update_stage 的 WITHDRAWN；岗位取消使用 CANCELLED；企业淘汰使用 REJECTED。targetId 填 [投递ID]，仅当用户明确说要删/记错了才提，不要因为用户说"这家跪了""被拒了"就提删除——被拒也是投递记录的一部分，应该用 update_stage 改成 REJECTED，不是删掉
- complete_task：把一条自建待办标记完成。targetId 填上面"自建待办"里对上的 [待办ID]
- mark_contacted：记一下刚联系过某个联系人（会自动清掉这个人的跟进提醒）。targetId 填上面"联系人"里对上的 [联系人ID]
- set_schedule：给某条投递记一个面试/笔试时间（新的一场）。targetId 填 [投递ID]，stage 填是哪一轮（INTERVIEW_1 一面、INTERVIEW_2 二面、INTERVIEW_3 终面、HR_INTERVIEW、ASSESSMENT 测评、OA 笔试），date 填开始时间 YYYY-MM-DDTHH:mm（只知道日期就 YYYY-MM-DD；笔试/测评「某日前完成」填截止日），dateEnd 可填结束时间，note 填会议链接/会议号/测评链接（原样）。比 update_stage 更合适：记面试时间一律用它
- reschedule：改期——已经记了时间的那一场换了时间。targetId 填"接下来"里那一场的 [进度ID]，date 填新时间 YYYY-MM-DDTHH:mm，note 只有会议链接也变了才填
- complete_step：把某一轮标记为已面完/已做完（开始等结果）。targetId 填 [进度ID]
- save_note：把用户说的面经/复盘记到那一轮上（追加，不会覆盖已有的）。targetId 填 [进度ID]，note 填整理好的内容：问了什么、怎么答的、感觉如何，保留用户原话里的题目
- mark_followed_up：用户说已经发邮件/打电话催过结果了。targetId 填 [进度ID]
每个 action 的 label 写成用户一眼能看懂的按钮文案，比如"记一条投递：字节跳动 后端开发"或"更新为一面，面试时间 3月5日"。label 只是按钮上的字，不能代替上面那些字段——该填 title/companyName/targetId 的一个都不能少，别只写 label 就交差。
问到安排（"今天有什么""下一场是什么时候"）直接按上面的「接下来」回答，带上时间和会议/测评链接；用户说"宝洁一面改到周五下午三点""刚面完腾讯二面，问了…"就给 reschedule / complete_step + save_note。
举例：用户说"我今天投了美团的数据分析，下周三一面"，就给两个 action —— 一个 log_application（如果候选池里没有这条，对上号就用 mark_position_applied），一个提醒他准备面试的 add_task。`;
