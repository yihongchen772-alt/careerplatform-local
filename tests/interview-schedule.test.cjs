const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");

// 面试安排: times on 投递 steps, their calendar copies and reminders, mail
// times written by themselves (with undo), and the 接下来 / filter logic.

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Buffer, URL, process, setTimeout, clearTimeout, Response, Request, Headers });
  return mod.exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

const schedule = load("src/lib/interview-schedule.ts");
const filters = load("src/lib/application-filters.ts");

const MIN = 60_000;
const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);
const dateOnly = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
const item = (over) => ({ key: "k", source: "stage", sourceId: "s", kind: "interview", startsAt: local(2026, 10, 12, 14).toISOString(), endsAt: null, hasTime: true, title: "一面", applicationId: "a", companyName: "示例科技", jobTitle: "产品经理", meetingInfo: null, ...over });

test("meeting links and numbers come out of pasted invitation text", () => {
  assert.equal(schedule.extractMeetingUrl("腾讯会议：https://meeting.tencent.com/dm/AbC123，会议号：123 456 789"), "https://meeting.tencent.com/dm/AbC123");
  assert.equal(schedule.extractMeetingUrl("链接（https://vc.feishu.cn/j/987654321）请准时"), "https://vc.feishu.cn/j/987654321");
  assert.equal(schedule.extractMeetingUrl("Zoom: https://zoom.us/j/1234567890?pwd=abc."), "https://zoom.us/j/1234567890?pwd=abc");
  assert.equal(schedule.extractMeetingUrl("上海市浦东新区某路 88 号 3 楼"), null);
  assert.equal(schedule.extractMeetingUrl("javascript:alert(1)"), null);
  assert.equal(schedule.extractMeetingNumber("腾讯会议 会议号：123 456 789 密码 1234"), "123 456 789");
  assert.equal(schedule.extractMeetingNumber("Meeting ID: 987-654-321"), "987 654 321");
  assert.equal(schedule.extractMeetingNumber("请于 14:00 到达"), null);
  assert.equal(schedule.kindFromText("CATL 在线测评通知"), "exam");
  assert.equal(schedule.kindFromText("荣耀 技术一面邀请"), "interview");
  assert.equal(schedule.kindFromText("宣讲会"), "event");
});

test("a date-only value keeps its own day; a timed one is read in local time", () => {
  assert.equal(schedule.itemDayKey({ startsAt: dateOnly(2026, 10, 21), hasTime: false }), "2026-10-21");
  assert.equal(schedule.itemDayKey({ startsAt: local(2026, 10, 21, 0, 30).toISOString(), hasTime: true }), "2026-10-21");
  assert.equal(schedule.absoluteWhen(dateOnly(2026, 10, 21), false), "10/21（周三）");
  assert.equal(schedule.absoluteWhen(local(2026, 10, 15, 14, 5).toISOString()), "10/15（周四）14:05");
});

test("countdowns and day names read like a person would say them", () => {
  const now = local(2026, 10, 12, 13, 25).getTime();
  const at = (h, mi, over = {}) => item({ startsAt: local(2026, 10, 12, h, mi).toISOString(), ...over });
  assert.equal(schedule.relativeText(at(14, 0), now), "还有 35 分钟");
  assert.equal(schedule.relativeText(at(15, 40), now), "还有 2 小时 15 分");
  assert.equal(schedule.relativeText(at(13, 0), now), "进行中");
  assert.equal(schedule.relativeText(at(13, 0, { endsAt: local(2026, 10, 12, 13, 20).toISOString() }), now), "已结束");
  assert.equal(schedule.whenText(at(14, 0, { endsAt: local(2026, 10, 12, 15).toISOString() }), now), "今天 14:00–15:00");
  assert.equal(schedule.whenText(item({ startsAt: local(2026, 10, 13, 9, 30).toISOString() }), now), "明天 09:30");
  assert.equal(schedule.whenText(item({ startsAt: local(2026, 10, 16, 9, 30).toISOString() }), now), "周五 10/16 09:30");
  assert.equal(schedule.relativeText(item({ startsAt: local(2026, 10, 16, 9, 30).toISOString() }), now), "还有 4 天");
  const deadline = (over) => item({ kind: "exam", hasTime: false, startsAt: dateOnly(2026, 10, 12), ...over });
  assert.equal(schedule.relativeText(deadline({}), now), "今天截止");
  assert.equal(schedule.relativeText(deadline({ kind: "interview" }), now), "今天，时间待定");
  assert.equal(schedule.relativeText(deadline({ startsAt: dateOnly(2026, 10, 10) }), now), "已过 2 天");
  assert.equal(schedule.relativeText(deadline({ startsAt: dateOnly(2026, 10, 10), endsAt: dateOnly(2026, 10, 14) }), now), "窗口还剩 2 天");
  assert.equal(schedule.relativeText(deadline({ startsAt: dateOnly(2026, 10, 15), endsAt: dateOnly(2026, 10, 18) }), now), "窗口 3 天后开放");
  assert.equal(schedule.whenText(deadline({ startsAt: dateOnly(2026, 10, 15), endsAt: dateOnly(2026, 10, 18) }), now), "10/15–10/18");
  assert.equal(schedule.urgencyOf(at(14, 0), now), "now");
  assert.equal(schedule.urgencyOf(at(18, 0), now), "today");
  assert.equal(schedule.urgencyOf(at(12, 0), now), "past");
});

test("what is coming up: the current step's time, a booked slot of another step, nothing once closed", () => {
  const now = local(2026, 10, 12, 10).getTime();
  const app = { id: "a", title: "产品经理", companyName: "示例科技", currentStage: "INTERVIEW_1", currentStageDate: local(2026, 10, 8, 9) };
  const rows = [
    { id: "oa", stage: "OA", enteredAt: local(2026, 10, 1, 9), nextDeadline: new Date(dateOnly(2026, 10, 5)), nextDeadlineEnd: null, nextHasTime: false },
    { id: "i1", stage: "INTERVIEW_1", enteredAt: local(2026, 10, 8, 9), nextDeadline: local(2026, 10, 14, 14), nextDeadlineEnd: local(2026, 10, 14, 15), nextHasTime: true, meetingInfo: "腾讯会议 https://meeting.tencent.com/dm/x" },
    { id: "group", stage: "INTERVIEW_1", stageLabel: "群面", enteredAt: local(2026, 10, 2, 9), nextDeadline: local(2026, 10, 13, 10), nextDeadlineEnd: null, nextHasTime: true },
  ];
  const items = schedule.applicationScheduleItems(app, rows, now);
  // The old 笔试 window is history; both booked slots still count.
  assert.deepEqual(plain(items.map((entry) => entry.sourceId)), ["group", "i1"]);
  assert.equal(items[0].title, "群面");
  assert.equal(items[1].meetingInfo, "腾讯会议 https://meeting.tencent.com/dm/x");
  assert.equal(schedule.nextScheduleItem(items, now).sourceId, "group");
  assert.equal(schedule.nextScheduleItem(items, local(2026, 10, 14, 14, 20).getTime()).sourceId, "i1");
  assert.equal(schedule.applicationScheduleItems({ ...app, currentStage: "REJECTED" }, rows, now).length, 0);
  // A current step whose deadline passed is still shown (time to update it).
  const past = schedule.applicationScheduleItems({ ...app, currentStage: "OA", currentStageDate: local(2026, 10, 1, 9) }, [rows[0]], now);
  assert.equal(schedule.nextScheduleItem(past, now).sourceId, "oa");
});

test("quick filters match what each card counts", () => {
  const now = local(2026, 10, 12, 10).getTime();
  const at = (stage, daysAgo = 1) => ({ currentStage: stage, currentStageDate: new Date(now - daysAgo * 86_400_000).toISOString() });
  const apps = [at("APPLIED", 20), at("SCREENING"), at("OA"), at("ASSESSMENT", 30), at("INTERVIEW_1"), at("HR_INTERVIEW"), at("OFFER"), at("ACCEPTED"), at("REJECTED", 40), at("WITHDRAWN")];
  const counts = plain(filters.filterCounts(apps, now));
  assert.deepEqual(counts, { all: 10, active: 7, exam: 2, interview: 2, waiting: 0, offer: 2, stale: 2, rejected: 1, closed: 3 });
  assert.equal(filters.parseFilter("interview"), "interview");
  assert.equal(filters.parseFilter("nonsense"), "all");
  assert.equal(filters.parseFilter(null), "all");
});

test("isolated DB: timed steps get a calendar copy and reminder that follow the step", async (t) => {
  const { db, mocks, cleanup } = await setup("schedule-sync");
  t.after(cleanup);
  const actions = load("src/lib/actions/applications.ts", mocks);
  const scheduleActions = load("src/lib/actions/schedule.ts", mocks);
  const productivity = load("src/lib/actions/productivity.ts", mocks);
  const reminders = load("src/lib/event-reminders.ts", mocks);
  await makeApp(db, "app", "SCREENING");

  const start = local(2027, 3, 15, 14);
  const { stageHistoryId } = await actions.addStageUpdate("app", { stage: "INTERVIEW_1", stageLabel: "技术一面", nextDeadline: start, nextDeadlineEnd: local(2027, 3, 15, 15), nextHasTime: true, meetingInfo: "腾讯会议 https://meeting.tencent.com/dm/abc 会议号：123 456 789", remindMinutes: 30 });
  let row = await db.stageHistory.findUnique({ where: { id: stageHistoryId }, include: { calendarEvent: { include: { reminders: true } } } });
  assert.equal(row.nextHasTime, true);
  assert.equal(row.remindMinutes, 30);
  assert.equal(row.calendarEvent.title, "示例科技 · 技术一面");
  assert.equal(row.calendarEvent.meetingInfo, row.meetingInfo);
  assert.equal(row.calendarEvent.dateKey, "2027-03-15");
  assert.equal(row.calendarEvent.reminders[0].scheduledAt.getTime(), start.getTime() - 30 * MIN);

  // A shown reminder is not repeated when something else on the step changes…
  await db.eventReminder.updateMany({ data: { deliveredAt: new Date() } });
  assert.equal((await actions.updateStageHistory(stageHistoryId, { stage: "INTERVIEW_1", stageLabel: "技术一面", note: "准备项目介绍", nextDeadline: start, nextDeadlineEnd: local(2027, 3, 15, 15), nextHasTime: true, meetingInfo: row.meetingInfo, remindMinutes: 30 })).ok, true);
  assert.notEqual((await db.eventReminder.findFirst()).deliveredAt, null);
  // …but a new time re-arms it, and the step's time is the user's again.
  await db.stageHistory.update({ where: { id: stageHistoryId }, data: { scheduleSource: "email" } });
  const later = local(2027, 3, 16, 10);
  assert.equal((await scheduleActions.setStageSchedule(stageHistoryId, { nextDeadline: later, nextDeadlineEnd: null, nextHasTime: true, meetingInfo: row.meetingInfo, remindMinutes: 60 })).ok, true);
  row = await db.stageHistory.findUnique({ where: { id: stageHistoryId }, include: { calendarEvent: { include: { reminders: true } } } });
  assert.equal(row.scheduleSource, null);
  assert.equal(row.calendarEvent.startsAt.getTime(), later.getTime());
  assert.equal(row.calendarEvent.reminders[0].deliveredAt, null);
  assert.equal(row.calendarEvent.reminders[0].scheduledAt.getTime(), later.getTime() - 60 * MIN);

  // The calendar window cannot edit or delete it; the step owns it.
  const event = row.calendarEvent;
  assert.equal((await productivity.deleteEvent(event.id, event.revision)).ok, false);
  assert.equal((await productivity.saveEvent({ id: event.id, revision: event.revision, title: "改名", description: "", startsAt: later, endsAt: null, allDay: false, dateKey: "2027-03-16", timeZone: "UTC", noteId: null, offsetMinutes: null })).ok, false);

  // The reminder says when and where, and which 投递 to open.
  await db.eventReminder.updateMany({ data: { scheduledAt: new Date(Date.now() - MIN) } });
  const claimed = await reminders.claimEventReminders("local-user");
  assert.equal(claimed.reminders.length, 1);
  assert.equal(claimed.reminders[0].applicationId, "app");
  assert.equal(claimed.reminders[0].startsAt.getTime(), later.getTime());
  assert.match(claimed.reminders[0].meetingInfo, /meeting\.tencent\.com/);

  // No reminder chosen: none kept.
  assert.equal((await scheduleActions.setStageSchedule(stageHistoryId, { nextDeadline: later, nextDeadlineEnd: null, nextHasTime: true, meetingInfo: null, remindMinutes: null })).ok, true);
  assert.equal(await db.eventReminder.count(), 0);
  assert.equal(await db.calendarEvent.count(), 1);
  // A closed 投递 stops reminding but keeps its calendar history.
  assert.equal((await scheduleActions.setStageSchedule(stageHistoryId, { nextDeadline: later, nextDeadlineEnd: null, nextHasTime: true, meetingInfo: null, remindMinutes: 15 })).ok, true);
  assert.equal(await db.eventReminder.count(), 1);
  const rejected = await actions.addStageUpdate("app", { stage: "REJECTED" });
  assert.equal(await db.eventReminder.count(), 0);
  assert.equal(await db.calendarEvent.count(), 1);
  assert.equal((await actions.deleteStageHistory(rejected.stageHistoryId)).ok, true);
  assert.equal(await db.eventReminder.count(), 1);
  // A date only (no clock time) is a deadline: no calendar copy.
  assert.equal((await scheduleActions.setStageSchedule(stageHistoryId, { nextDeadline: new Date("2027-03-20"), nextDeadlineEnd: null, nextHasTime: false, meetingInfo: null })).ok, true);
  assert.equal(await db.calendarEvent.count(), 0);
  // Deleting the step takes its copy along.
  assert.equal((await scheduleActions.setStageSchedule(stageHistoryId, { nextDeadline: later, nextDeadlineEnd: null, nextHasTime: true, meetingInfo: null, remindMinutes: 30 })).ok, true);
  assert.equal(await db.calendarEvent.count(), 1);
  assert.equal((await actions.deleteStageHistory(stageHistoryId)).ok, true);
  assert.equal(await db.calendarEvent.count(), 0);
});

test("isolated DB: mail times are written by themselves, once, never over the user's own, and undo restores", async (t) => {
  const { db, mocks, cleanup, mail } = await setup("schedule-mail");
  t.after(cleanup);
  await makeApp(db, "mail-app", "SCREENING", "acme");
  await makeApp(db, "typed-app", "INTERVIEW_1", "beta");
  const typed = await db.stageHistory.findFirst({ where: { applicationId: "typed-app" } });
  await db.stageHistory.update({ where: { id: typed.id }, data: { nextDeadline: local(2027, 3, 20, 9), nextHasTime: true, remindMinutes: 30 } });

  const inbox = load("src/lib/actions/inbox-scan.ts", mocks);
  const autoLib = load("src/lib/auto-progress.ts", mocks);
  const scheduleActions = load("src/lib/actions/schedule.ts", mocks);
  const loader = load("src/lib/schedule-loader.ts", mocks);
  const draft = (localStart, extra = {}) => ({ title: "面试", localStart, localEnd: "", timeZone: "", location: "", meetingUrl: "", evidence: "邮件原文时间", ...extra });

  mail.emails = [
    { uid: 1, subject: "示例科技 一面邀请", from: "hr@acme.test", date: new Date(), snippet: "3月15日14:00 一面" },
    { uid: 2, subject: "测试银行 面试时间", from: "hr@bank.test", date: new Date(), snippet: "3月21日10:00" },
    { uid: 3, subject: "某集团 宣讲与测评", from: "hr@x.test", date: new Date(), snippet: "3月18日19:00" },
    { uid: 4, subject: "某集团 宣讲与测评（提醒）", from: "hr@x.test", date: new Date(), snippet: "3月18日19:00" },
  ];
  mail.ai = { results: [
    { index: 0, isJobRelated: true, type: "面试邀请", company: "示例科技", summary: "一面", applicationId: "mail-app", stage: "INTERVIEW_1", stageLabel: "技术一面", event: draft("2027-03-15T14:00", { meetingUrl: "https://meeting.tencent.com/dm/abc", location: "线上" }) },
    { index: 1, isJobRelated: true, type: "面试邀请", company: "测试银行", summary: "改时间", applicationId: "typed-app", stage: "INTERVIEW_1", stageLabel: null, event: draft("2027-03-21T10:00") },
    { index: 2, isJobRelated: true, type: "测评通知", company: "某集团", summary: "测评", applicationId: null, stage: null, stageLabel: null, event: draft("2027-03-18T19:00", { title: "某集团 在线测评" }) },
    { index: 3, isJobRelated: true, type: "测评通知", company: "某集团", summary: "测评提醒", applicationId: null, stage: null, stageLabel: null, event: draft("2027-03-18T19:00", { title: "某集团 在线测评" }) },
  ] };
  const scan = await inbox.scanInboxNow();
  assert.equal(scan.ok, true);
  assert.equal(scan.data.scheduled, 2);

  // Matched: the mail moved it to 一面 and its time went onto that step.
  const mailApp = await db.application.findUnique({ where: { id: "mail-app" }, include: { stageHistory: { include: { calendarEvent: { include: { reminders: true } } } } } });
  assert.equal(mailApp.currentStage, "INTERVIEW_1");
  const step = mailApp.stageHistory.find((row) => row.stage === "INTERVIEW_1");
  assert.equal(step.nextDeadline.getTime(), local(2027, 3, 15, 14).getTime());
  assert.equal(step.scheduleSource, "email");
  assert.equal(step.meetingInfo, "线上 https://meeting.tencent.com/dm/abc");
  assert.equal(step.calendarEvent.reminders[0].offsetMinutes, 30);
  const mailTask = await db.personalTask.findFirst({ where: { title: "面试邀请：示例科技" } });
  assert.equal(mailTask.done, true);
  assert.equal(mailTask.mailEventId, step.calendarEvent.id);

  // The user's own time is kept; the mail's waits in 接下来 as a conflict.
  const typedAfter = await db.stageHistory.findUnique({ where: { id: typed.id } });
  assert.equal(typedAfter.nextDeadline.getTime(), local(2027, 3, 20, 9).getTime());
  const conflictTask = await db.personalTask.findFirst({ where: { title: "面试邀请：测试银行" } });
  assert.equal(conflictTask.done, false);
  assert.equal(conflictTask.mailAppliedAt, null);

  // Unmatched: one calendar item for two mails about the same slot.
  const standalone = await db.calendarEvent.findMany({ where: { stageHistoryId: null } });
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0].source, "email");
  assert.equal(standalone[0].title, "某集团 在线测评");

  const banner = await autoLib.loadAutoScheduleItems("local-user");
  assert.equal(banner.length, 2);
  const upcoming = await loader.loadUpcomingSchedule("local-user", new Date(), 3650);
  const pendingMail = upcoming.find((entry) => entry.source === "mail");
  assert.equal(pendingMail.sourceId, conflictTask.id);
  assert.equal(pendingMail.conflictsWith, local(2027, 3, 20, 9).toISOString());
  assert.equal(upcoming.filter((entry) => entry.source === "event").length, 1);
  assert.ok(upcoming.some((entry) => entry.source === "stage" && entry.applicationId === "mail-app"));

  // 写入日程 replaces the typed time on request.
  assert.equal((await scheduleActions.writeMailSchedule(conflictTask.id)).ok, true);
  assert.equal((await db.stageHistory.findUnique({ where: { id: typed.id } })).nextDeadline.getTime(), local(2027, 3, 21, 10).getTime());

  // A rescan of the same messages writes nothing twice.
  assert.equal((await inbox.scanInboxNow()).data.scheduled, 0);
  assert.equal(await db.calendarEvent.count({ where: { stageHistoryId: null } }), 1);

  // Undo puts the step back the way it was; the mail returns to the 待办.
  assert.equal((await scheduleActions.undoMailSchedule(mailTask.id)).ok, true);
  const restored = await db.stageHistory.findUnique({ where: { id: step.id }, include: { calendarEvent: true } });
  assert.equal(restored.nextDeadline, null);
  assert.equal(restored.calendarEvent, null);
  const undoneTask = await db.personalTask.findUnique({ where: { id: mailTask.id } });
  assert.equal(undoneTask.done, false);
  assert.notEqual(undoneTask.mailUndoneAt, null);
  assert.equal((await scheduleActions.undoMailSchedule(mailTask.id)).ok, false);

  // The standalone item can be attached to a 投递 by hand.
  const eventTask = await db.personalTask.findFirst({ where: { mailEventId: standalone[0].id, mailAppliedAt: { not: null } } });
  assert.equal((await scheduleActions.attachEventToApplication(standalone[0].id, "mail-app")).ok, true);
  const attached = await db.stageHistory.findUnique({ where: { id: step.id }, include: { calendarEvent: true } });
  assert.equal(attached.nextDeadline.getTime(), local(2027, 3, 18, 19).getTime());
  assert.equal(await db.calendarEvent.count({ where: { id: standalone[0].id } }), 0);
  assert.equal((await db.personalTask.findUnique({ where: { id: eventTask.id } })).mailEventId, attached.calendarEvent.id);

  // An undo after the user changed the time keeps the user's version.
  mail.emails = [{ uid: 9, subject: "测试银行 二面", from: "hr@bank.test", date: new Date(), snippet: "二面" }];
  await makeApp(db, "second-app", "INTERVIEW_2", "beta");
  mail.ai = { results: [{ index: 0, isJobRelated: true, type: "二面邀请", company: "测试银行", summary: "二面", applicationId: "second-app", stage: "INTERVIEW_2", stageLabel: null, event: draft("2027-04-01T15:00") }] };
  assert.equal((await inbox.scanInboxNow()).data.scheduled, 1);
  const secondRow = await db.stageHistory.findFirst({ where: { applicationId: "second-app" } });
  const secondTask = await db.personalTask.findFirst({ where: { title: "二面邀请：测试银行" } });
  assert.equal((await scheduleActions.setStageSchedule(secondRow.id, { nextDeadline: local(2027, 4, 2, 15), nextDeadlineEnd: null, nextHasTime: true, meetingInfo: null, remindMinutes: 30 })).ok, true);
  const kept = await scheduleActions.undoMailSchedule(secondTask.id);
  assert.equal(kept.data.kept, true);
  assert.equal((await db.stageHistory.findUnique({ where: { id: secondRow.id } })).nextDeadline.getTime(), local(2027, 4, 2, 15).getTime());

  // With 识别直接更新 off, times only wait in 接下来.
  await db.user.update({ where: { id: "local-user" }, data: { autoApplyProgress: false } });
  mail.emails = [{ uid: 10, subject: "某公司 笔试", from: "hr@y.test", date: new Date(), snippet: "笔试" }];
  mail.ai = { results: [{ index: 0, isJobRelated: true, type: "笔试通知", company: "某公司", summary: "笔试", event: draft("2027-05-01T09:00") }] };
  assert.equal((await inbox.scanInboxNow()).data.scheduled, 0);
  const waiting = await loader.loadUpcomingSchedule("local-user", new Date(), 3650);
  assert.ok(waiting.some((entry) => entry.source === "mail" && entry.title === "面试" && entry.startsAt === local(2027, 5, 1, 9).toISOString()));

  // Several waiting copies of one invitation: writing one settles the rest.
  mail.emails = [11, 12].map((uid) => ({ uid, subject: "某公司 宣讲会", from: "hr@z.test", date: new Date(), snippet: "宣讲会" }));
  mail.ai = { results: [0, 1].map((index) => ({ index, isJobRelated: true, type: "进度更新", company: "某公司", summary: "宣讲会", event: draft("2027-05-02T13:30", { title: "某公司 宣讲会" }) })) };
  await inbox.scanInboxNow();
  const copies = await db.personalTask.findMany({ where: { title: "进度更新：某公司" }, orderBy: { createdAt: "asc" } });
  assert.equal(copies.length, 2);
  const upcomingCopies = (await loader.loadUpcomingSchedule("local-user", new Date(), 3650)).filter((entry) => entry.title === "某公司 宣讲会");
  assert.equal(upcomingCopies.length, 1);
  assert.equal((await scheduleActions.writeMailSchedule(copies[0].id)).ok, true);
  const settled = await db.personalTask.findUnique({ where: { id: copies[1].id } });
  assert.equal(settled.done, true);
  assert.equal(settled.mailEventId, (await db.personalTask.findUnique({ where: { id: copies[0].id } })).mailEventId);
  assert.equal((await scheduleActions.undoMailSchedule(copies[0].id)).ok, true);
  assert.equal((await db.personalTask.findUnique({ where: { id: copies[1].id } })).mailEventId, null);
});

test("isolated DB: batch stage change and its undo; to-dos and ICS list a step once", async (t) => {
  const { db, mocks, cleanup } = await setup("schedule-bulk");
  t.after(cleanup);
  for (const id of ["one", "two", "three"]) await makeApp(db, id, id === "three" ? "REJECTED" : "APPLIED");
  const scheduleActions = load("src/lib/actions/schedule.ts", mocks);
  const result = await scheduleActions.bulkUpdateStage(["one", "two", "three"], "REJECTED");
  assert.equal(result.ok, true);
  assert.equal(result.data.created.length, 2);
  assert.equal(result.data.skipped, 1);
  assert.equal((await db.application.findUnique({ where: { id: "one" } })).currentStage, "REJECTED");
  assert.equal((await db.stageHistory.findFirst({ where: { applicationId: "one", stage: "REJECTED" } })).terminatedAtStage, "APPLIED");
  assert.equal((await scheduleActions.undoBulkStage(result.data.created)).ok, true);
  assert.equal((await db.application.findUnique({ where: { id: "one" } })).currentStage, "APPLIED");
  assert.equal((await db.application.findUnique({ where: { id: "three" } })).currentStage, "REJECTED");
  assert.equal((await scheduleActions.bulkUpdateStage(["one"], "ACCEPTED")).ok, false);

  // A timed step: one to-do with its clock time, not a second one from its calendar copy.
  const soon = new Date(Date.now() + 3 * 60 * MIN);
  const row = await db.stageHistory.findFirst({ where: { applicationId: "two" } });
  assert.equal((await scheduleActions.setStageSchedule(row.id, { nextDeadline: soon, nextDeadlineEnd: null, nextHasTime: true, meetingInfo: "腾讯会议 https://meeting.tencent.com/dm/x", remindMinutes: 30 })).ok, true);
  // An earlier step's old deadline is history, not a to-do.
  const app = await db.application.findUnique({ where: { id: "one" } });
  await db.stageHistory.create({ data: { applicationId: "one", stage: "OA", enteredAt: new Date(Date.now() - 10 * 86_400_000), nextDeadline: new Date(Date.now() - 5 * 86_400_000) } });
  await db.stageHistory.create({ data: { applicationId: "one", stage: "SCREENING", enteredAt: new Date(Date.now() - 86_400_000) } });
  await db.application.update({ where: { id: "one" }, data: { currentStage: "SCREENING", currentStageDate: new Date(Date.now() - 86_400_000) } });
  assert.ok(app);
  const { buildTodos } = load("src/lib/todos.ts", mocks);
  const apps = await db.application.findMany({ include: { company: true } });
  const histories = await db.stageHistory.findMany({ where: { nextDeadline: { not: null } }, include: { application: { include: { company: true } } } });
  const events = await db.calendarEvent.findMany();
  assert.equal(events.length, 1);
  const todos = buildTodos(apps, [], histories, [], [], events);
  const steps = todos.filter((todo) => todo.id.startsWith("next-") || todo.id.startsWith("event-"));
  assert.equal(steps.length, 1);
  assert.match(steps[0].sublabel, /^今天 \d{2}:\d{2} · 还有 (2|3) 小时/);

  const route = load("src/app/api/calendar-export/route.ts", mocks);
  await db.stageHistory.update({ where: { id: (await db.stageHistory.findFirst({ where: { applicationId: "one", stage: "OA" } })).id }, data: { nextDeadline: new Date("2027-01-05T00:00:00.000Z"), nextDeadlineEnd: new Date("2027-01-07T00:00:00.000Z") } });
  const ics = await (await route.GET(new Request("http://localhost/api/calendar-export"))).text();
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, 2);
  assert.ok(ics.includes("TRIGGER:-PT30M"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20270105"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20270108"));
});

async function setup(name) {
  const base = path.resolve(__dirname, "../.local-run/schedule-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, `${name}-`));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const migration of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((entry) => /^\d/.test(entry)).sort()) {
    sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", migration, "migration.sql"), "utf8"));
  }
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  await db.user.create({ data: { id: "local-user", email: "fixture@local" } });
  await db.company.create({ data: { id: "acme", name: "示例科技" } });
  await db.company.create({ data: { id: "beta", name: "测试银行" } });
  const mail = { emails: [], ai: null };
  const mocks = {
    "@/lib/db": { db },
    "@/lib/session": { LOCAL_USER_ID: "local-user", requireUser: async () => ({ id: "local-user" }) },
    "next/cache": { revalidatePath() {} },
    "@/lib/ai-providers": { getUserAiConfig: async () => ({ provider: "fixture" }), callTextAi: async () => mail.ai },
    "@/lib/imap": { getUserScanAccounts: async () => [{ id: "box", label: "测试邮箱" }], fetchRecentEmails: async () => mail.emails },
  };
  const cleanup = async () => {
    await db.$disconnect();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup");
    fs.rmSync(root, { recursive: true });
  };
  return { db, mocks, cleanup, mail };
}

function makeApp(db, id, stage, companyId = "acme") {
  const day = local(2026, 10, 1, 10);
  return db.application.create({
    data: { id, userId: "local-user", companyId, title: `${id} 岗位`, currentStage: stage, currentStageDate: day, appliedDate: day, stageHistory: { create: { stage, enteredAt: day } } },
  });
}
