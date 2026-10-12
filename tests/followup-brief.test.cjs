const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");

// v1.14: which round a time is for, 面完 / 等结果, 撞期, the tray list, the
// interview brief, and the 网申浏览器's saved passwords.

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Buffer, URL, process, setTimeout, clearTimeout, Response, Request, Headers });
  return mod.exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const schedule = load("src/lib/interview-schedule.ts");
const DAY = 86_400_000;
const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);

test("a time goes on the round it is for", () => {
  assert.equal(schedule.stageFromText("荣耀 二面邀请"), "INTERVIEW_2");
  assert.equal(schedule.stageFromText("终面安排"), "INTERVIEW_3");
  assert.equal(schedule.stageFromText("HR 面通知"), "HR_INTERVIEW");
  assert.equal(schedule.stageFromText("在线测评通知"), "ASSESSMENT");
  assert.equal(schedule.stageFromText("笔试邀请"), "OA");
  assert.equal(schedule.stageFromText("面试邀请"), null);
  // A plain 「面试」 is the current interview round, or 一面 before any.
  assert.equal(schedule.targetStageFor("APPLIED", "面试邀请"), "INTERVIEW_1");
  assert.equal(schedule.targetStageFor("INTERVIEW_2", "面试时间确认"), "INTERVIEW_2");
  assert.equal(schedule.targetStageFor("SCREENING", "宣讲会"), null);
  assert.equal(schedule.targetStageFor("OA", "笔试提醒"), "OA");
  assert.equal(schedule.defaultScheduleStage("APPLIED"), "INTERVIEW_1");
  assert.equal(schedule.defaultScheduleStage("ASSESSMENT"), "ASSESSMENT");
  assert.deepEqual(plain(schedule.scheduleStageChoices("INTERVIEW_2")), ["ASSESSMENT", "OA", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER"]);
  assert.equal(schedule.scheduleStageChoices("APPLIED").length, 7);
});

test("a finished round waits for the result and asks to follow up after a week", () => {
  const now = local(2026, 10, 20, 12).getTime();
  const interview = { stage: "INTERVIEW_1", nextDeadline: local(2026, 10, 20, 9), nextDeadlineEnd: local(2026, 10, 20, 10), nextHasTime: true };
  let state = schedule.stepState(interview, now);
  assert.equal(state.phase, "waiting");
  assert.equal(state.days, 0);
  assert.equal(state.byTime, true);
  assert.equal(schedule.waitingText("INTERVIEW_1", state), "已面完 · 等结果");
  state = schedule.stepState(interview, now + 8 * DAY);
  assert.equal(state.followUp, true);
  assert.equal(schedule.waitingText("INTERVIEW_1", state), "已面完 · 等结果 8 天 · 该跟进了");
  // 已跟进 rests the nudge for another week.
  assert.equal(schedule.stepState({ ...interview, followedUpAt: new Date(now + 7 * DAY) }, now + 8 * DAY).followUp, false);
  assert.equal(schedule.stepState({ ...interview, nextDeadline: local(2026, 10, 21, 9), nextDeadlineEnd: null }, now).phase, "upcoming");
  // 测评: a passed deadline asks whether it was done; marking it done waits.
  const exam = { stage: "ASSESSMENT", nextDeadline: new Date(Date.UTC(2026, 9, 18)), nextDeadlineEnd: null, nextHasTime: false };
  assert.equal(schedule.stepState(exam, now).phase, "due");
  const done = schedule.stepState({ ...exam, completedAt: new Date(now - 3 * DAY) }, now);
  assert.equal(done.phase, "waiting");
  assert.equal(schedule.waitingText("ASSESSMENT", done), "已完成 · 等结果 3 天");
  assert.equal(plain(schedule.stepView({ id: "r", ...exam }, now)).phase, "due");
  assert.equal(schedule.stepView({ id: "r", stage: "SCREENING", nextDeadline: null, nextDeadlineEnd: null }, now), null);
  assert.equal(plain(schedule.stepView({ id: "r", stage: "OA", nextDeadline: null, nextDeadlineEnd: null }, now)).phase, "open");
  // A step marked done no longer counts down.
  const app = { id: "a", title: "岗位", companyName: "公司", currentStage: "ASSESSMENT", currentStageDate: local(2026, 10, 10) };
  assert.equal(schedule.applicationScheduleItems(app, [{ id: "x", stage: "ASSESSMENT", enteredAt: local(2026, 10, 10), nextDeadline: new Date(Date.UTC(2026, 9, 25)), nextDeadlineEnd: null, completedAt: new Date(now) }], now).length, 0);
});

test("overlapping times are found, with an untimed end counting as an hour", () => {
  const slot = (key, h, mi, endH = null) => ({ key, startsAt: local(2026, 10, 21, h, mi).toISOString(), endsAt: endH === null ? null : local(2026, 10, 21, endH).toISOString(), label: key });
  const slots = [slot("a", 10, 0), slot("b", 14, 0, 16), slot("c", 18, 0)];
  assert.deepEqual(plain(schedule.overlapping(slots, local(2026, 10, 21, 10, 30), null).map((s) => s.key)), ["a"]);
  assert.deepEqual(plain(schedule.overlapping(slots, local(2026, 10, 21, 15), local(2026, 10, 21, 18)).map((s) => s.key)), ["b"]);
  assert.equal(schedule.overlapping(slots, local(2026, 10, 21, 11), null).length, 0);
  assert.equal(schedule.overlapping(slots, local(2026, 10, 21, 10), null, "a").length, 0);
  const item = (key, h) => ({ key, source: "stage", sourceId: key, kind: "interview", startsAt: local(2026, 10, 21, h).toISOString(), endsAt: null, hasTime: true, title: key, applicationId: null, companyName: null, jobTitle: null, meetingInfo: null });
  assert.deepEqual([...schedule.clashingKeys([item("x", 10), item("y", 10), item("z", 15)])].sort(), ["x", "y"]);
});

test("the tray lists what is next with its own actions", () => {
  const { upcomingMenuItems, trayTooltip } = require("../electron/tray-menu.js");
  const calls = [];
  const handlers = { openMeeting: (u) => calls.push(["meet", u]), copyText: (t) => calls.push(["copy", t]), openApplication: (id) => calls.push(["app", id]), openBrief: (id) => calls.push(["brief", id]), openList: () => calls.push(["list"]) };
  assert.equal(upcomingMenuItems([], handlers)[0].enabled, false);
  const items = upcomingMenuItems([
    { source: "stage", kind: "interview", label: "今天 14:00 宝洁 · 一面", relative: "还有 2 小时", applicationId: "app1", meetingUrl: "https://meeting.tencent.com/dm/x", meetingNumber: "123 456 789", meetingInfo: "腾讯会议" },
    { source: "mail", label: "邮件识别" },
    { source: "event", kind: "exam", label: "明天 10:00 测评", relative: "还有 1 天", applicationId: null, meetingInfo: "线上" },
  ], handlers);
  assert.equal(items[0].label, "接下来");
  assert.equal(items.length, 3);
  assert.deepEqual(items[1].submenu.map((entry) => entry.label), ["进入会议", "复制会议号 123 456 789", "面试速览", "打开投递"]);
  items[1].submenu[0].click();
  items[1].submenu[1].click();
  items[1].submenu[2].click();
  assert.deepEqual(calls, [["meet", "https://meeting.tencent.com/dm/x"], ["copy", "123 456 789"], ["brief", "app1"]]);
  assert.deepEqual(items[2].submenu.map((entry) => entry.label), ["复制会议信息 / 地点"]);
  assert.match(trayTooltip({ today: 1, items: [{ source: "stage", label: "今天 14:00 宝洁 · 一面", relative: "还有 2 小时" }] }), /^求职罗盘 · 今天 14:00/);
  assert.equal(trayTooltip({ today: 0, items: [] }), "求职罗盘");
});

test("saved passwords: one account per site (a company on a shared host is its own site), encrypted at rest", () => {
  const { createLoginStore, loginRealm } = require("../electron/saved-logins.js");
  assert.equal(loginRealm("https://app.mokahr.com/campus-recruitment/bytedance/38642#/login"), "https://app.mokahr.com/bytedance");
  assert.equal(loginRealm("https://app.mokahr.com/campus-recruitment/meituan/1#/"), "https://app.mokahr.com/meituan");
  assert.equal(loginRealm("https://wecruit.hotjob.cn/SU601778b25d83dc072073230a/pb/account.html"), "https://wecruit.hotjob.cn/SU601778b25d83dc072073230a");
  assert.equal(loginRealm("https://vivo.zhiye.com/personal/login?redirect=1"), "https://vivo.zhiye.com");
  assert.equal(loginRealm("https://hr-campus.vivo.com/personal/deliveryRecord"), "https://hr-campus.vivo.com");
  assert.equal(loginRealm("about:blank"), null);
  assert.equal(loginRealm("file:///etc/passwd"), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-logins-"));
  try {
    fs.writeFileSync(path.join(dir, ".secret"), "fixture-secret-0123456789abcdef");
    const store = createLoginStore({ dir });
    const realm = "https://app.mokahr.com/bytedance";
    assert.equal(store.status(realm, "13800000000", "Pa55-word"), "new");
    const id = store.save(realm, "13800000000", "Pa55-word");
    assert.equal(store.status(realm, "13800000000", "Pa55-word"), "same");
    assert.equal(store.status(realm, "13800000000", "other"), "changed");
    const raw = fs.readFileSync(path.join(dir, "saved-logins.json"), "utf8");
    assert.equal(raw.includes("Pa55-word"), false, "password must not be stored in plain text");
    assert.equal((fs.statSync(path.join(dir, "saved-logins.json")).mode & 0o077), 0, "file readable only by the owner");
    assert.equal(store.get(id).password, "Pa55-word");
    assert.equal(store.forRealm(realm).length, 1);
    assert.equal(store.forRealm("https://app.mokahr.com/meituan").length, 0);
    assert.equal(store.nearby("https://app.mokahr.com/meituan").length, 1);
    // Saving again updates, never duplicates.
    store.save(realm, "13800000000", "new-pass");
    assert.equal(store.list().length, 1);
    assert.equal(store.get(id).password, "new-pass");
    store.addNever("https://example.test");
    assert.equal(store.isNever("https://example.test"), true);
    store.removeNever("https://example.test");
    assert.equal(store.isNever("https://example.test"), false);
    // A different install's key cannot read it.
    fs.writeFileSync(path.join(dir, ".secret"), "another-install-secret");
    assert.equal(createLoginStore({ dir }).get(id), null);
    assert.equal(store.remove(id), true);
    assert.equal(store.list().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("isolated DB: rounds, 已完成 and its reminders, follow-up to-dos, mail inference, 撞期, and the brief", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/followup-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const migration of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((entry) => /^\d/.test(entry)).sort()) {
    sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", migration, "migration.sql"), "utf8"));
  }
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  t.after(async () => {
    await db.$disconnect();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup");
    fs.rmSync(root, { recursive: true });
  });
  await db.user.create({ data: { id: "local-user", email: "fixture@local" } });
  await db.company.create({ data: { id: "acme", name: "示例科技" } });
  const day = local(2026, 10, 1, 10);
  const makeApp = (id, stage) => db.application.create({ data: { id, userId: "local-user", companyId: "acme", title: `${id} 岗位`, currentStage: stage, currentStageDate: day, appliedDate: day, stageHistory: { create: { stage, enteredAt: day } } } });
  let aiResponse = null;
  const mocks = {
    "@/lib/db": { db },
    "@/lib/session": { LOCAL_USER_ID: "local-user", requireUser: async () => ({ id: "local-user" }) },
    "next/cache": { revalidatePath() {} },
    "@/lib/ai-providers": { getUserAiConfig: async () => ({ provider: "fixture" }), callTextAi: async () => aiResponse },
    "@/lib/resume-context": { getResumeContext: async () => ({ resumeName: "简历", resumeText: "简历内容：数据分析实习，负责 A/B 实验" }) },
  };
  const actions = load("src/lib/actions/schedule.ts", mocks);

  // 「添加面试时间」 at 已投递 for 一面: the 投递 moves to 一面 and the time is there.
  await makeApp("applied", "APPLIED");
  const start = local(2027, 3, 15, 14);
  const added = await actions.addStageSchedule("applied", "INTERVIEW_1", { nextDeadline: start, nextDeadlineEnd: null, nextHasTime: true, meetingInfo: "腾讯会议 https://meeting.tencent.com/dm/a", remindMinutes: 30 });
  assert.equal(added.ok, true);
  assert.equal(added.data.created, true);
  let app = await db.application.findUnique({ where: { id: "applied" } });
  assert.equal(app.currentStage, "INTERVIEW_1");
  const row = await db.stageHistory.findUnique({ where: { id: added.data.stageHistoryId }, include: { calendarEvent: { include: { reminders: true } } } });
  assert.equal(row.stage, "INTERVIEW_1");
  assert.equal(row.calendarEvent.title, "示例科技 · 一面");
  assert.equal(row.calendarEvent.reminders.length, 1);
  // The same round again: the current step, nothing new.
  const again = await actions.addStageSchedule("applied", "INTERVIEW_1", { nextDeadline: local(2027, 3, 16, 9), nextDeadlineEnd: null, nextHasTime: true, meetingInfo: null, remindMinutes: 30 });
  assert.equal(again.data.created, false);
  assert.equal(again.data.stageHistoryId, row.id);
  assert.equal((await actions.addStageSchedule("applied", "APPLIED", { nextDeadline: start, nextDeadlineEnd: null, nextHasTime: true })).ok, false);

  // 撞期.
  await makeApp("other", "INTERVIEW_2");
  const otherRow = await db.stageHistory.findFirst({ where: { applicationId: "other" } });
  await actions.setStageSchedule(otherRow.id, { nextDeadline: local(2027, 3, 16, 9, 30), nextDeadlineEnd: null, nextHasTime: true, meetingInfo: null, remindMinutes: null });
  const clashes = await actions.scheduleConflicts(local(2027, 3, 16, 9).toISOString(), null, otherRow.id);
  assert.deepEqual(plain(clashes.map((clash) => clash.label)), ["示例科技 · 一面"]);
  assert.equal((await actions.scheduleConflicts(local(2027, 3, 16, 13).toISOString(), null, null)).length, 0);

  // 我已完成: no reminder for a done step; taking it back brings it back.
  assert.equal((await actions.setStepCompleted(row.id, true)).ok, true);
  assert.equal(await db.eventReminder.count({ where: { event: { stageHistoryId: row.id } } }), 0);
  assert.equal((await actions.setStepCompleted(row.id, false)).ok, true);
  assert.equal(await db.eventReminder.count({ where: { event: { stageHistoryId: row.id } } }), 1);

  // Notes after the round reach 面经库's rows; 已跟进 is recorded.
  assert.equal((await actions.saveStepNote(row.id, "  问了 A/B 实验的指标设计  ")).ok, true);
  assert.equal((await db.stageHistory.findUnique({ where: { id: row.id } })).note, "问了 A/B 实验的指标设计");
  assert.equal((await actions.markFollowedUp(row.id)).ok, true);
  assert.notEqual((await db.stageHistory.findUnique({ where: { id: row.id } })).followedUpAt, null);

  // To-dos: a done 测评 is quiet until a week of waiting, then a follow-up.
  await makeApp("exam", "ASSESSMENT");
  const examRow = await db.stageHistory.findFirst({ where: { applicationId: "exam" } });
  await db.stageHistory.update({ where: { id: examRow.id }, data: { nextDeadline: new Date(Date.now() - 2 * DAY), completedAt: new Date(Date.now() - DAY) } });
  const { buildTodos } = load("src/lib/todos.ts", mocks);
  const todosFor = async () => buildTodos(await db.application.findMany({ include: { company: true } }), [], await db.stageHistory.findMany({ where: { nextDeadline: { not: null } }, include: { application: { include: { company: true } } } }), [], [], []);
  assert.equal((await todosFor()).filter((todo) => todo.id.includes(examRow.id)).length, 0);
  await db.stageHistory.update({ where: { id: examRow.id }, data: { completedAt: new Date(Date.now() - 9 * DAY) } });
  const follow = (await todosFor()).find((todo) => todo.id === `follow-${examRow.id}`);
  assert.ok(follow);
  assert.match(follow.sublabel, /等结果 9 天 · 该跟进了/);

  // Mail with no recognised round, 投递 still at 已投递: 「面试」 means 一面.
  await makeApp("mail", "APPLIED");
  const task = await db.personalTask.create({ data: { userId: "local-user", applicationId: "mail", title: "面试邀请：示例科技", note: "约面试\n\n邮件主题：面试时间确认", mailEventDraft: { title: "面试", localStart: "2027-04-01T15:00", localEnd: "", timeZone: "", location: "", meetingUrl: "", evidence: "4月1日15:00" } } });
  const mailSchedule = load("src/lib/mail-schedule.ts", mocks);
  const placed = await db.$transaction((tx) => mailSchedule.applyMailSchedule(tx, { taskId: task.id, userId: "local-user", stage: null }));
  assert.equal(placed.status, "stage");
  app = await db.application.findUnique({ where: { id: "mail" }, include: { stageHistory: true } });
  assert.equal(app.currentStage, "INTERVIEW_1");
  const auto = app.stageHistory.find((entry) => entry.stage === "INTERVIEW_1");
  assert.equal(auto.autoSource, "email");
  assert.equal(auto.nextDeadline.getTime(), local(2027, 4, 1, 15).getTime());
  // A mail about a round behind the current one stays off the steps.
  await makeApp("ahead", "INTERVIEW_3");
  const late = await db.personalTask.create({ data: { userId: "local-user", applicationId: "ahead", title: "一面提醒", mailEventDraft: { title: "一面", localStart: "2027-04-02T10:00", localEnd: "", timeZone: "", location: "", meetingUrl: "", evidence: "" } } });
  const kept = await db.$transaction((tx) => mailSchedule.applyMailSchedule(tx, { taskId: late.id, userId: "local-user", stage: null }));
  assert.equal(kept.status, "event");
  assert.equal((await db.application.findUnique({ where: { id: "ahead" } })).currentStage, "INTERVIEW_3");

  // 面试速览: written once, kept, and odd model output is tidied rather than lost.
  const brief = load("src/lib/actions/interview-brief.ts", mocks);
  await db.resumeVersion.create({ data: { id: "resume", userId: "local-user", name: "简历" } });
  aiResponse = { summary: "重点讲实验设计", focus: [{ point: "实验设计", why: "JD 要求 A/B 测试" }], stories: [{ point: "实验设计", experience: "数据分析实习", howToTell: "背景-做法-结果" }], questions: Array.from({ length: 12 }, (_, i) => ({ question: `问题${i}`, hint: "要点" })), askBack: ["团队目前最想解决什么问题？"], reminders: ["提前测好摄像头"] };
  const written = await brief.generateInterviewBrief("applied", null);
  assert.equal(written.ok, true);
  assert.equal(written.data.questions.length, 10);
  const stored = await db.interviewBrief.findUnique({ where: { applicationId: "applied" } });
  assert.equal(stored.content.summary, "重点讲实验设计");
  aiResponse = { nonsense: true };
  assert.equal((await brief.generateInterviewBrief("applied", null)).ok, false);
  assert.equal((await db.interviewBrief.findUnique({ where: { applicationId: "applied" } })).content.summary, "重点讲实验设计");
});
