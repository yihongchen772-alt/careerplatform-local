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
  assert.equal(rightStep.nextDeadline.getTime(), new Date(2027, 5, 9, 10).getTime());
  assert.match(rightStep.meetingInfo, /m\.example\.com/);
  const moved2 = await db.personalTask.findUnique({ where: { id: w.id } });
  assert.equal(moved2.applicationId, "right");
  assert.ok(moved2.mailEventId);
  assert.equal(moved2.mailUndo, null);
  // To a calendar item of its own, then cleared elsewhere.
  assert.equal((await actions.moveStageSchedule(rightStep.id, null)).ok, true);
  const alone = await db.calendarEvent.findFirst({ where: { userId, stageHistoryId: null, title: { contains: "星海机器人" } } });
  assert.equal(alone.startsAt.getTime(), new Date(2027, 5, 9, 10).getTime());
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
