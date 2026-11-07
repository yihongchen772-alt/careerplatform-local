const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), process, console, Intl, Date, URL, Set, Map, JSON, Math, Number, String, RegExp, Array, Object, Promise, Error, Boolean, Symbol, BigInt, parseInt, parseFloat, isNaN }, { filename: file });
  return mod.exports;
}

const extract = load("src/lib/mail-time-extract.ts");
const mail = (over) => ({ ai: null, subject: "", body: "", mailDate: new Date(2027, 2, 1, 10), type: "面试邀请", company: "示例科技", ...over });
const draft = (over) => ({ title: "", localStart: "", localEnd: "", timeZone: "Asia/Shanghai", location: "", meetingUrl: "", evidence: "", deadline: "", windowStart: "", booking: false, ...over });

test("a questionnaire after the interview is not an appointment, whatever time it quotes", () => {
  for (const [subject, type] of [["面试体验评价", "面试体验评价"], ["邀请你填写满意度调查", "进度更新"], ["校招问卷", "其他"], ["Candidate survey", "其他"]]) assert.equal(extract.mailIsAfterthought(subject, type), true, subject);
  assert.equal(extract.mailIsAfterthought("面试邀请", "面试邀请"), false);
  assert.equal(extract.completeMailDraft(mail({ type: "面试体验评价", subject: "请评价本次面试", body: "面试时间:2027-03-05 14:40", ai: draft({ localStart: "2027-03-05T14:40" }) })), null);
  const scan = read("src/lib/actions/inbox-scan.ts");
  assert.match(scan, /done: afterthought/);
  assert.match(scan, /created && matched && stage && !afterthought/, "and it moves no 投递");
});

test("a 测评 called a 问卷 is still a 测评; a result is not a questionnaire", () => {
  assert.equal(extract.mailIsAfterthought("职业性格问卷测评通知", "测评通知"), false);
  assert.equal(extract.mailIsAfterthought("请完成人才问卷", "笔试通知"), false);
  assert.equal(extract.mailIsAfterthought("面试结果通知", "拒信", "经面试评价，很遗憾未通过"), false);
  assert.equal(extract.mailIsAfterthought("诚邀您评价本次面试体验", "其他"), true);
  assert.equal(extract.mailIsAfterthought("通知", "其他", "邀请对本次面试进行评价"), true);
});

test("a mail signing with less than the record finds the 投递, but only with a generic ending", () => {
  const { matchMailApplication: match } = load("src/lib/mail-application-match.ts");
  const app = (id, companyName) => ({ id, companyName, title: "工程师" });
  for (const [signed, record] of [["星海", "星海股份"], ["星海智能", "星海智能！"], ["星海", "星海honor"], ["星海电器", "星海电器中国"], ["星海华创", "星海华创微电子"]]) assert.equal(match({ subject: "通知", company: signed }, [app("a", record)]), "a", record);
  assert.equal(match({ subject: "通知", company: "京北" }, [app("a", "京北方")]), null, "another company");
  assert.equal(match({ subject: "通知", company: "星海" }, [app("a", "星海股份"), app("b", "星海科技")]), null, "two companies it could be");
});

test("a cancellation shows on the row until a newer invitation", () => {
  const { cancelNoticeFor } = load("src/lib/pending-mail.ts", { "@/lib/db": { db: {} } });
  const at = (d) => new Date(2027, 0, d);
  const m = (title, subject, d, hasTime = false, applicationId = null, first = "摘要", done = false) => ({ id: `${title}${d}`, title, note: `${first}\n\n邮件主题：${subject}`, applicationId, createdAt: at(d), hasTime, done });
  const item = { applicationId: null, companyName: "星海", title: "一面" };
  assert.equal(cancelNoticeFor(item, [m("面试邀请：星海", "面试邀请", 1, true), m("其他：星海", "面试取消通知", 2)]).subject, "面试取消通知");
  assert.equal(cancelNoticeFor(item, [m("其他：星海", "面试取消通知", 2, false, null, "摘要", true)]), null, "「知道了」 clears it");
  assert.equal(cancelNoticeFor({ ...item, kind: "exam" }, [m("其他：星海", "面试取消通知", 2)]), null, "an interview's cancellation says nothing about a 笔试");
  assert.equal(cancelNoticeFor({ ...item, kind: "exam" }, [m("其他：星海", "笔试取消通知", 2)]).subject, "笔试取消通知");
  assert.equal(cancelNoticeFor(item, [m("其他：星海", "面试取消通知", 2), m("面试邀请：星海", "面试改期邀请", 3, true)]), null, "a new time since");
  assert.equal(cancelNoticeFor(item, [m("面试邀请：星海", "面试邀请", 2, false, null, "如需取消面试请联系HR")]), null, "an offer to cancel is not a cancellation");
  assert.equal(cancelNoticeFor(item, [m("其他：天工", "面试取消通知", 2)]), null, "another company");
  assert.equal(cancelNoticeFor({ applicationId: "a", companyName: "星海", title: "一面" }, [m("其他：星海", "面试取消", 2, false, "b")]), null, "another 投递 of that company");
});

test("one 宣讲会 in three mails is one row in the panel", () => {
  const { pendingMailRows } = load("src/lib/pending-mail.ts", { "@/lib/db": { db: {} } });
  const t = (id, d) => ({ id, title: "宣讲会邀请：星海", note: "摘要", mailEventDraft: draft({ title: "星海宣讲会", localStart: "2030-05-11T14:45" }), applicationId: null, createdAt: new Date(2027, 0, d) });
  assert.equal(pendingMailRows([t("a", 1), t("b", 2), t("c", 3)], Date.now(), new Set()).length, 1);
});

test("the AI's pick among a company's 投递 is checked against the job the mail names", () => {
  const { correctMailApplication: fix } = load("src/lib/mail-application-match.ts");
  const app = (id, title, companyName = "星海") => ({ id, title, companyName });
  const apps = [app("motion", "控制算法工程师（人形机器人）"), app("test", "软件测试工程师"), app("robot", "机器人算法工程师（智能）"), app("algo", "算法工程师"), app("x", "销售", "天工")];
  assert.equal(fix({ subject: "面试邀请", summary: "确认您预约的【通用研发】软件测试工程师初试" }, "motion", apps), "test", "the mail names another");
  assert.equal(fix({ subject: "面试邀请", summary: "控制算法工程师岗位的面试" }, "motion", apps), "motion", "named without its bracket");
  assert.equal(fix({ subject: "面试邀请", summary: "请预约时间" }, "motion", apps), "motion", "names none: the pick stands");
  assert.equal(fix({ subject: "面试", summary: "机器人算法工程师岗位" }, "algo", apps), "robot", "the longer title, not the part of it");
  assert.equal(fix({ subject: "通知", summary: "软件测试工程师和控制算法工程师岗位都已通过" }, "motion", apps), "motion", "the pick is named too");
  assert.equal(fix({ subject: "面试", summary: "销售" }, "x", apps), "x", "one 投递 at that company");
  assert.equal(fix({ subject: "x" }, "gone", apps), "gone");
  const scan = read("src/lib/actions/inbox-scan.ts");
  assert.match(scan, /correctMailApplication\(\{ subject: email\.subject, summary: c\.summary/);
  assert.match(scan, /邮件时间（用户本地时间/, "「今天」 is read in the user's clock, not UTC");
  assert.match(scan, /mailBeforeStage\(email\.date, app\.currentStageDate\)/);
});

test("a mail at 02:00 isn't older than a stage entered as that day", () => {
  const { mailBeforeStage, localStamp } = load("src/lib/dates.ts");
  const day = new Date("2027-03-05T00:00:00.000Z");
  assert.equal(mailBeforeStage(new Date(2027, 2, 5, 2), day), false);
  assert.equal(mailBeforeStage(new Date(2027, 2, 4, 23), day), true);
  const exact = new Date(2027, 2, 5, 10, 30);
  assert.equal(mailBeforeStage(new Date(2027, 2, 5, 10, 0), exact), true, "a stage with a clock time compares exactly");
  assert.equal(mailBeforeStage(new Date(2027, 2, 5, 11, 0), exact), false);
  assert.equal(localStamp(new Date(2027, 2, 5, 1, 7)), "2027-03-05 01:07");
});

test("dates in settings render the same on the server and the client", () => {
  for (const file of ["src/components/settings/mail-accounts-card.tsx", "src/components/productivity/mini-calendar.tsx"]) assert.doesNotMatch(read(file), /toLocale(?:Date|Time)?String\(\)/, file);
});

test("group names in 转化率: a pasted table row keeps its name, a sentence isn't a channel", () => {
  const { trackLabel, sourceLabel, computeConversion } = load("src/lib/analytics.ts");
  assert.equal(trackLabel("技术方向-智能方向(校招) 志愿信息: 第2志愿 申请时间: 2027-01-13 19:58 简历状态: 已申请 操作: 撤销"), "技术方向-智能方向(校招)");
  assert.equal(trackLabel("(校招) 志愿信息: 第1志愿 申请时间: 2027-01-13"), null, "nothing left but a tag");
  assert.equal(trackLabel("后端开发"), "后端开发");
  assert.equal(sourceLabel("官网"), "官网");
  assert.equal(sourceLabel("线下面试两轮，已拿到实习 Offer，本人主动放弃"), "其他");
  assert.equal(sourceLabel("渠道：招聘系统"), "其他");
  const row = (source) => ({ currentStage: "APPLIED", stageHistory: [], source, position: null });
  assert.equal(computeConversion([row("官网"), row("写了一句话，不是渠道"), row("渠道：内推")]).bySource.map((r) => r.key).sort().join(), ["其他", "官网"].sort().join());
});

test("the numbers agree between pages; a date-only stage shows no clock; calendar labels name the step", () => {
  const dash = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.match(dash, /\["OFFER", "ACCEPTED", "DECLINED"\]\.includes\(a\.currentStage\)/);
  assert.match(dash, /const inProgress = total - closed;/);
  assert.match(dash, /task\.mailUndoneAt \? mailTime/);
  assert.match(read("src/components/applications/stage-timeline.tsx"), /% 86_400_000 === 0/);
  assert.doesNotMatch(read("src/app/(dashboard)/calendar/page.tsx"), /title\} 下一步/);
  assert.doesNotMatch(read("src/app/api/calendar-export/route.ts"), /title\} 下一步/);
  assert.match(read("src/app/(dashboard)/insights/page.tsx"), /其余 \{folded\.length\} 组/);
});

test("company names: leftovers come off on request, and the old name still finds the 投递", () => {
  const { tidyCompanyName } = load("src/lib/application-identity.ts", { "@/lib/db": { db: {} } });
  assert.equal(tidyCompanyName("星海智能！"), "星海智能");
  assert.equal(tidyCompanyName("星海集团“星火计划”"), "星海集团");
  assert.equal(tidyCompanyName("星海汽车 奔向远方"), "星海汽车");
  for (const fine of ["星海科技", "Star Robotics", "EcoFlow 星海创新", "星海（北京）有限公司"]) assert.equal(tidyCompanyName(fine), null, fine);
  const actions = read("src/lib/actions/companies.ts");
  assert.match(actions, /companyAlias\.create\(\{ data: \{ companyId: company\.id, alias: pair\.from \} \}\)/);
  assert.match(actions, /undoTidyCompanyNames/);
  assert.match(read("src/components/applications/company-name-banner.tsx"), /label: "撤销"/);
  const dash = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.match(dash, /!listedAbove\.has\(todo\.id\)/, "接下来 and 待办 don't list one thing twice");
  assert.match(read("src/app/(dashboard)/applications/[id]/page.tsx"), /<DeleteApplicationButton/);
});

test("the summary pills stay one line, name what closes first, and don't contradict themselves", () => {
  const { dashboardBrief } = load("src/lib/dashboard-brief.ts");
  const now = new Date(2027, 2, 1, 21).getTime();
  const iso = (d, h = 0) => new Date(2027, 2, d, h).toISOString();
  const day = (d) => `2027-03-${String(d).padStart(2, "0")}T00:00:00.000Z`;
  const step = (id, company, title, startsAt, hasTime, endsAt = null, source = "stage") => ({ key: `${source}:${id}`, source, sourceId: id, kind: "exam", startsAt, endsAt, hasTime, title, companyName: company });
  const long = step("a", "星海微电子装备集团股份有限公司", "预约面试时间 · 星海微电子装备 机电控制工程师 技术面试", iso(2, 15), true);
  const brief = dashboardBrief([long], [], now);
  assert.ok(brief[0].length <= 40, brief[0]);
  assert.doesNotMatch(brief[0], /预约面试时间/);
  assert.ok(!brief.includes("眼前没有要赶的事"), "not beside something tomorrow");
  const opened = step("w1", "星海", "测评（截止）", day(2), false, day(20));
  const closing = step("w2", "天工", "测评（截止）", day(5), false, day(9));
  assert.match(dashboardBrief([opened, closing], [], now).join("|"), /最早 天工 3\/9 截止/, "the one that closes first");
  const todo = (id, urgency = "urgent") => ({ id, urgency });
  assert.match(dashboardBrief([long], [todo("next-a"), todo("task-1")], now).at(-1), /^另有 1 件事/, "what's named isn't counted twice");
  assert.equal(dashboardBrief([], [], now).at(-1), "眼前没有要赶的事");
  assert.match(read("src/app/(dashboard)/dashboard/page.tsx"), /hero-pill block max-w-full truncate/);
});

test("with no sheet and nothing imported, 秋招信息库 opens on the place to paste the link", () => {
  assert.match(read("src/app/(dashboard)/leads/page.tsx"), /sources > 0 \|\| ownLeads === 0 \? "postings" : "mine"/);
});

test("restoring a backup keeps 小欧's memory and the sheet subscription", () => {
  const core = read("src/lib/backup-core.ts");
  for (const table of ["agentConversation", "agentMemory", "agentBrief"]) assert.match(core, new RegExp(`"${table}"`));
  const restore = read("src/lib/actions/backup.ts");
  assert.match(restore, /agentMemory: \[\["userId", "user"\]\]/);
  assert.match(restore, /const sheets = await tx\.postingSource\.findMany/);
  assert.match(restore, /tx\.postingSource\.create\(\{ data: sheet \}\)/);
});

test("deadlines read and show as the mail meant them; shortcuts and default resume land where they should", () => {
  const { mailTime } = load("src/lib/mail-time.ts");
  const dead = (deadline) => mailTime(draft({ title: "测评", deadline }), "Asia/Shanghai");
  assert.equal(dead("2027-05-08T00:00").startsAt.toISOString().slice(0, 10), "2027-05-07", "00:00 is the end of the day before");
  assert.match(dead("2027-05-08T00:00").meetingInfo, /截止 24:00/);
  assert.equal(dead("2027-05-07T24:00").startsAt.toISOString().slice(0, 10), "2027-05-07");
  assert.equal(dead("2027-05-07T15:00").startsAt.toISOString().slice(0, 10), "2027-05-07");
  const { meetingSummary } = load("src/lib/interview-schedule.ts");
  assert.match(meetingSummary("https://a.example.com/x 截止 24:00", true), /24:00/);
  assert.match(meetingSummary("地点：三楼", false), /地点 三楼/);
  const page = read("src/app/(dashboard)/mock-interview/page.tsx");
  assert.match(page, /key=\{fromApplication \?\? focusMix \?\? "new"\}/);
  assert.match(page, /orderBy: \[\{ isDefault: "desc" \}/);
  assert.match(read("src/lib/actions/resumes.ts"), /if \(resume\.isDefault\)/);
});

test("秋招信息库 comes back to its filters, page, scroll and the row last opened", () => {
  const keeper = read("src/components/leads/list-position-keeper.tsx");
  assert.match(keeper, /if \(!search && saved\?\.search\)/, "a bare address goes back to the remembered list");
  assert.match(keeper, /router\.replace\(`\/leads\?\$\{saved\.search\}`, \{ scroll: false \}\)/);
  assert.match(keeper, /row\.scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(keeper, /a\[href\^="\/browser"\]/);
  const panel = read("src/components/leads/postings-panel.tsx");
  assert.match(panel, /data-posting-id=\{row\.id\}/);
  assert.match(panel, /清除筛选/);
  assert.match(panel, /if \(filters\.page > pages\) redirect/);
  assert.match(read("src/app/(dashboard)/leads/page.tsx"), /<ListPositionKeeper \/>/);
});

test("a deadline to book a slot is known as one, even when the AI read it", () => {
  const read1 = extract.completeMailDraft(mail({ ai: draft({ title: "示例科技 线上复试", deadline: "2027-03-05T13:30", evidence: "面试日期: 2027/03/06；请您在今天13:30前根据提供的时间段进行面试预约" }) }));
  assert.equal(read1.booking, true);
  assert.match(read1.title, /^预约面试时间 · /);
  const exam = extract.completeMailDraft(mail({ type: "测评通知", ai: draft({ title: "测评", deadline: "2027-03-05", evidence: "请在3月5日前完成测评" }) }));
  assert.equal(exam.booking, false);
});

test("isolated DB: what the applicant settled stays settled; one thing is one calendar item", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/v56-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const migration of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((entry) => /^\d/.test(entry)).sort()) sql.exec(read(`prisma/migrations/${migration}/migration.sql`));
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  t.after(async () => {
    await db.$disconnect();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup");
    fs.rmSync(root, { recursive: true });
  });
  const userId = "local-user";
  await db.user.create({ data: { id: userId, email: "fixture@local" } });
  await db.company.create({ data: { id: "acme", name: "示例科技" } });
  await db.company.create({ data: { id: "other", name: "星海机器人" } });
  const day = new Date(2026, 9, 1, 10);
  const makeApp = (id, stage, companyId = "acme") => db.application.create({ data: { id, userId, companyId, title: `${id} 岗位`, currentStage: stage, currentStageDate: day, appliedDate: day, stageHistory: { create: { stage, enteredAt: day } } } });
  const mocks = { "@/lib/db": { db }, "@/lib/session": { LOCAL_USER_ID: userId, requireUser: async () => ({ id: userId }) }, "next/cache": { revalidatePath() {} } };
  const schedule = load("src/lib/mail-schedule.ts", mocks);
  const actions = load("src/lib/actions/schedule.ts", mocks);
  let n = 0;
  const task = (title, event, applicationId = null, extra = {}) => db.personalTask.create({ data: { userId, title, applicationId, sourceMailKey: `a:${++n}`, note: `摘要\n\n邮件主题：${title}`, mailEventDraft: event ? draft(event) : undefined, ...extra } });
  const apply = (id, force = false) => db.$transaction((tx) => schedule.applyMailSchedule(tx, { taskId: id, userId, stage: null, force }));
  const events = (contains) => db.calendarEvent.findMany({ where: { userId, title: { contains } } });

  // One 测评, three wordings: one item, and the link the first lacked comes along.
  const a = await task("测评通知：中国电信", { title: "中国电信校招AI测评", deadline: "2027-05-07T24:00", evidence: "11月7日24:00" });
  assert.equal((await apply(a.id)).status, "event");
  const b = await task("测评通知（AI测评提醒）：中国电信（北京电信）", { title: "中国电信2027校园招聘AI测评", deadline: "2027-05-07T24:00", meetingUrl: "https://e.example.com/x" });
  assert.equal((await apply(b.id)).status, "same");
  assert.equal((await events("中国电信")).length, 1);
  assert.match((await events("中国电信"))[0].meetingInfo, /e\.example\.com/);
  // Items from before this rule are merged: one kept, the link and the mails moved over.
  const dupA = await db.calendarEvent.create({ data: { userId, title: "南山通信AI测评（截止）", description: "", startsAt: new Date(2027, 4, 9), allDay: true, dateKey: "2027-05-09", timeZone: "Asia/Shanghai", source: "email", meetingInfo: "截止 24:00" } });
  const dupB = await db.calendarEvent.create({ data: { userId, title: "南山通信校招测评（截止）", description: "", startsAt: new Date(2027, 4, 9), allDay: true, dateKey: "2027-05-09", timeZone: "Asia/Shanghai", source: "email", meetingInfo: "https://n.example.com/x" } });
  const otherCo = await db.calendarEvent.create({ data: { userId, title: "北山测评（截止）", description: "", startsAt: new Date(2027, 4, 9), allDay: true, dateKey: "2027-05-09", timeZone: "Asia/Shanghai", source: "email" } });
  await task("测评通知：南山通信", null, null, { mailEventId: dupA.id, done: true });
  const dupMail = await task("测评通知（提醒）：南山通信（北京）", null, null, { mailEventId: dupB.id, done: true, mailUndo: { kind: "event", eventId: dupB.id } });
  await task("测评通知：北山", null, null, { mailEventId: otherCo.id, done: true });
  assert.equal(await db.$transaction((tx) => schedule.mergeDuplicateMailEvents(tx, userId)), 1);
  assert.equal(await db.calendarEvent.count({ where: { title: { contains: "南山通信" } } }), 1);
  assert.match((await db.calendarEvent.findUnique({ where: { id: dupA.id } })).meetingInfo, /n\.example\.com/);
  const movedMail = await db.personalTask.findUnique({ where: { id: dupMail.id } });
  assert.equal(movedMail.mailEventId, dupA.id);
  assert.equal(movedMail.mailUndo.eventId, dupA.id);
  assert.ok(await db.calendarEvent.findUnique({ where: { id: otherCo.id } }), "another company's stays");
  // Same company, another kind on that day is its own item.
  const c = await task("面试邀请：中国电信", { title: "中国电信 面试截止", deadline: "2027-05-07" });
  assert.equal((await apply(c.id)).status, "event");

  // 宣讲会: waits to be picked, and never lands on a 投递's step.
  await makeApp("talk", "APPLIED");
  const talk = await task("宣讲会邀请：示例科技", { title: "示例科技 宣讲会", localStart: "2027-05-11T14:45" }, "talk");
  assert.deepEqual({ ...(await apply(talk.id)) }, { status: "skipped", reason: "optional" });
  assert.equal((await db.personalTask.findUnique({ where: { id: talk.id } })).done, false, "still offered");
  assert.equal((await apply(talk.id, true)).status, "event");
  const talkApp = await db.application.findUnique({ where: { id: "talk" }, include: { stageHistory: true } });
  assert.equal(talkApp.stageHistory[0].nextDeadline, null);

  // Deleted, then a reminder repeats the time: it stays gone.
  const first = await task("面试邀请：天工智能", { title: "天工智能 一面", localStart: "2027-06-01T10:00" });
  assert.equal((await apply(first.id)).status, "event");
  const [made] = await events("天工智能");
  assert.equal((await actions.deleteCalendarItem(made.id)).ok, true);
  const again = await task("面试提醒：天工智能有限公司", { title: "天工智能面试提醒", localStart: "2027-06-01T10:00" });
  assert.equal((await apply(again.id)).status, "same");
  assert.equal((await events("天工智能")).length, 0);
  // A new time from them is news.
  const moved = await task("面试邀请：天工智能", { title: "天工智能 一面改期", localStart: "2027-06-02T10:00" });
  assert.equal((await apply(moved.id)).status, "event");

  // Moved by hand, then a reminder of the old time: no second item.
  const one = await task("面试邀请：远山科技", { title: "远山科技 一面", localStart: "2027-06-03T10:00" });
  await apply(one.id);
  const [own] = await events("远山科技");
  assert.equal((await actions.updateCalendarItem(own.id, own.title, { nextDeadline: new Date(2027, 5, 3, 16), nextDeadlineEnd: null, nextHasTime: true, meetingInfo: null, remindMinutes: 30 })).ok, true);
  const nudge = await task("面试提醒：远山科技", { title: "远山科技面试提醒", localStart: "2027-06-03T10:00" });
  assert.equal((await apply(nudge.id)).status, "same");
  assert.equal((await events("远山科技")).length, 1);
  assert.equal((await db.personalTask.findUnique({ where: { id: nudge.id } })).mailEventId, own.id);

  // 撤销, then a reminder: not written back. Asking for it by hand still works.
  await makeApp("undo", "INTERVIEW_1");
  const u = await task("面试邀请：示例科技", { title: "示例科技 一面", localStart: "2027-06-05T10:00" }, "undo");
  assert.equal((await apply(u.id)).status, "stage");
  await db.$transaction((tx) => schedule.undoMailScheduleWrite(tx, u.id, userId));
  const u2 = await task("面试提醒：示例科技", { title: "示例科技 面试提醒", localStart: "2027-06-05T10:00" }, "undo");
  assert.equal((await apply(u2.id)).status, "same");
  assert.equal((await db.stageHistory.findFirst({ where: { applicationId: "undo" } })).nextDeadline, null);
  const u3 = await task("面试提醒：示例科技", { title: "示例科技 面试提醒", localStart: "2027-06-05T10:00" }, "undo");
  assert.equal((await apply(u3.id, true)).status, "stage");

  // 「时间另行通知」 is answered by the mail with the time; 笔试 isn't answered by an interview.
  const silent = await task("面试邀请：青禾科技（上海）有限公司", null, null, { createdAt: new Date(2026, 0, 1) });
  const silentExam = await task("笔试通知：青禾科技", null, null, { createdAt: new Date(2026, 0, 1) });
  const manual = await db.personalTask.create({ data: { userId, title: "面试准备：青禾科技" } });
  const timed = await task("AI面试邀请：青禾科技", { title: "青禾科技 AI面试", localStart: "2027-06-07T10:00" });
  assert.equal((await apply(timed.id)).status, "event");
  assert.equal((await db.personalTask.findUnique({ where: { id: silent.id } })).done, true);
  assert.equal((await db.personalTask.findUnique({ where: { id: silentExam.id } })).done, false);
  assert.equal((await db.personalTask.findUnique({ where: { id: manual.id } })).done, false, "only mail");

  // On the wrong 投递: moved over, and the step the mail invented goes with it.
  await makeApp("wrong", "APPLIED");
  await makeApp("right", "APPLIED", "other");
  const w = await task("面试邀请：星海机器人", { title: "星海机器人 一面", localStart: "2027-06-09T10:00", meetingUrl: "https://m.example.com/1" }, "wrong");
  assert.equal((await apply(w.id)).status, "stage");
  let wrong = await db.application.findUnique({ where: { id: "wrong" }, include: { stageHistory: true } });
  assert.equal(wrong.currentStage, "INTERVIEW_1");
  const step = wrong.stageHistory.find((row) => row.stage === "INTERVIEW_1");
  assert.equal((await actions.moveStageSchedule(step.id, "right")).ok, true);
  wrong = await db.application.findUnique({ where: { id: "wrong" }, include: { stageHistory: true } });
  assert.equal(wrong.currentStage, "APPLIED", "back where it was");
  assert.equal(wrong.stageHistory.length, 1);
  const right = await db.application.findUnique({ where: { id: "right" }, include: { stageHistory: true } });
  assert.equal(right.currentStage, "INTERVIEW_1");
  const rightStep = right.stageHistory.find((row) => row.stage === "INTERVIEW_1");
  assert.equal(rightStep.nextDeadline.getTime(), Date.UTC(2027, 5, 9, 2));
  assert.match(rightStep.meetingInfo, /m\.example\.com/);
  const moved2 = await db.personalTask.findUnique({ where: { id: w.id } });
  assert.equal(moved2.applicationId, "right");
  assert.ok(moved2.mailEventId);
  assert.equal(moved2.mailUndo, null);
  // The name the mail signs with is remembered for that company; a reminder wrongly matched again stays out.
  assert.ok(await db.companyAlias.findUnique({ where: { alias: "星海机器人" } }) === null, "already its name");
  const again2 = await task("面试提醒：星海机器人", { title: "提醒", localStart: "2027-06-09T10:00" }, "wrong");
  assert.equal((await apply(again2.id)).status, "same");
  assert.equal((await db.application.findUnique({ where: { id: "wrong" } })).currentStage, "APPLIED");
  await db.company.create({ data: { id: "third", name: "云岭智造" } });
  await makeApp("third", "INTERVIEW_1", "third");
  await makeApp("firstco", "INTERVIEW_1");
  const signed = await task("面试邀请：云岭智能制造（北京）", { title: "云岭一面", localStart: "2027-06-10T10:00" }, "firstco");
  assert.equal((await apply(signed.id)).status, "stage");
  const signedRow = await db.stageHistory.findFirst({ where: { applicationId: "firstco" } });
  assert.equal((await actions.moveStageSchedule(signedRow.id, "third")).ok, true);
  assert.equal((await db.companyAlias.findUnique({ where: { alias: "云岭智能制造" } })).companyId, "third");
  // A step made date-only loses its calendar copy: the mail behind it stops pointing there.
  await makeApp("dated", "INTERVIEW_1");
  const dm = await task("面试邀请：示例科技", { title: "示例科技 一面", localStart: "2027-06-13T10:00" }, "dated");
  await apply(dm.id);
  const datedRow = await db.stageHistory.findFirst({ where: { applicationId: "dated" } });
  assert.ok((await db.personalTask.findUnique({ where: { id: dm.id } })).mailEventId);
  assert.equal((await actions.setStageSchedule(datedRow.id, { nextDeadline: new Date("2027-06-13T00:00:00.000Z"), nextDeadlineEnd: null, nextHasTime: false, meetingInfo: null, remindMinutes: null })).ok, true);
  assert.equal((await db.personalTask.findUnique({ where: { id: dm.id } })).mailEventId, null);
  // A step the applicant wrote in stays, only its time moves.
  await makeApp("noted", "APPLIED");
  const nm = await task("面试邀请：长风科技", { title: "长风一面", localStart: "2027-06-12T10:00" }, "noted");
  await apply(nm.id);
  const notedRow = await db.stageHistory.findFirst({ where: { applicationId: "noted", stage: "INTERVIEW_1" } });
  await db.stageHistory.update({ where: { id: notedRow.id }, data: { note: "我自己写的准备要点" } });
  assert.equal((await actions.moveStageSchedule(notedRow.id, null)).ok, true);
  const keptRow = await db.stageHistory.findUnique({ where: { id: notedRow.id } });
  assert.equal(keptRow.note, "我自己写的准备要点");
  assert.equal(keptRow.nextDeadline, null);
  // Onto a step with a time of its own: that one stays, this one goes beside it.
  await makeApp("busy", "INTERVIEW_1");
  await makeApp("from", "INTERVIEW_1");
  await db.stageHistory.updateMany({ where: { applicationId: "busy" }, data: { nextDeadline: new Date(2027, 5, 20, 9), nextHasTime: true } });
  await db.stageHistory.updateMany({ where: { applicationId: "from" }, data: { nextDeadline: new Date(2027, 5, 21, 9), nextHasTime: true } });
  const fromRow = await db.stageHistory.findFirst({ where: { applicationId: "from" } });
  assert.equal((await actions.moveStageSchedule(fromRow.id, "busy")).ok, true);
  const busyRows = await db.stageHistory.findMany({ where: { applicationId: "busy" }, orderBy: { nextDeadline: "asc" } });
  assert.deepEqual(busyRows.map((row) => row.nextDeadline.getTime()), [new Date(2027, 5, 20, 9).getTime(), new Date(2027, 5, 21, 9).getTime()]);
  // To a calendar item of its own, then cleared elsewhere.
  assert.equal((await actions.moveStageSchedule(rightStep.id, null)).ok, true);
  const alone = await db.calendarEvent.findFirst({ where: { userId, stageHistoryId: null, title: { contains: "星海机器人" } } });
  assert.equal(alone.startsAt.getTime(), Date.UTC(2027, 5, 9, 2));
  assert.equal((await db.application.findUnique({ where: { id: "right" } })).currentStage, "APPLIED");
  assert.equal((await db.personalTask.findUnique({ where: { id: w.id } })).applicationId, null);

  await makeApp("clear", "INTERVIEW_1");
  const cl = await task("面试邀请：示例科技", { title: "示例科技 一面", localStart: "2027-06-11T10:00" }, "clear");
  await apply(cl.id);
  const clearRow = await db.stageHistory.findFirst({ where: { applicationId: "clear" } });
  assert.equal((await actions.clearStageTime(clearRow.id)).ok, true);
  assert.equal((await db.stageHistory.findUnique({ where: { id: clearRow.id } })).nextDeadline, null);
  assert.equal(await db.calendarEvent.count({ where: { stageHistoryId: clearRow.id } }), 0);
  const cl2 = await task("面试提醒：示例科技", { title: "提醒", localStart: "2027-06-11T10:00" }, "clear");
  assert.equal((await apply(cl2.id)).status, "same", "a cleared time stays cleared");
});

test("the edit dialog offers the fixes; the panel lets a wrong time be changed before it goes on", () => {
  const dialog = read("src/components/schedule/edit-schedule-dialog.tsx");
  assert.match(dialog, /不是这条投递/);
  assert.match(dialog, /这个时间不对，清掉/);
  assert.match(dialog, /不属于任何投递，单独放日历/);
  assert.match(read("src/components/calendar/pending-mail-panel.tsx"), /label="改一下"/);
  assert.match(read("src/components/dashboard/mail-event-dialog.tsx"), /needsCheck && !typed/);
  assert.match(read("src/lib/actions/mail-calendar.ts"), /!RECRUIT_EVENT\.test/);
  assert.match(read("src/lib/pending-mail.ts"), /mailIsAfterthought\("", task\.title\)/);
});

test("a 投递 keeps the JD with the record and the detail page shows it", () => {
  assert.match(read("prisma/schema.prisma"), /jdSnapshot String\?/);
  assert.match(read("src/lib/actions/submitted-application.ts"), /jdSnapshot: jdFrozen/);
  assert.match(read("src/app/(dashboard)/applications/[id]/page.tsx"), /<ApplicationJdCard/);
  assert.match(read("src/components/applications/application-jd-card.tsx"), /粘贴 JD/);
  // Every way of marking a job applied keeps the JD, and the 面试 tools read the kept one.
  assert.equal(read("src/lib/actions/positions.ts").match(/jdSnapshot: position\.jdText/g).length, 2);
  assert.match(read("src/lib/actions/applications.ts"), /jdSnapshot: linked\?\.jdText/);
  for (const file of ["src/lib/actions/interview-qa.ts", "src/lib/actions/interview-brief.ts", "src/app/(dashboard)/applications/[id]/brief/page.tsx"]) assert.match(read(file), /applicationJd\(application\)/);
});

test("a form opened in a new tab keeps the JD of the page it was opened from; clearing and bad links are refused", () => {
  const view = read("electron/browser-view.js");
  assert.match(view, /void passJobPageOn\(tab, createTab\(details\.url/);
  assert.match(view, /tab\.jdPage\.fromOpener \|\| visited\.has\(tab\.jdPage\.url\)/);
  assert.match(view, /opener\.jdPage\?\.url === showing && !opened\.jdPage/);
  assert.match(read("src/lib/actions/application-jd.ts"), /JD 不能为空/);
  assert.match(read("src/components/applications/application-jd-card.tsx"), /\^https\?:/);
});
