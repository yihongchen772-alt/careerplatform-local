const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 日历读邮件: times the AI left out but the mail states plainly.
const cache = {};
function loadTs(relative) {
  if (cache[relative]) return cache[relative];
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => (name.startsWith("@/") ? loadTs(`src/${name.slice(2)}.ts`) : require(name));
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: localRequire, Intl, Date, Math }, { filename: relative });
  return (cache[relative] = mod.exports);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const { extractMailTime, completeMailDraft, mailRulesOutTime } = loadTs("src/lib/mail-time-extract.ts");
const { mailTime } = loadTs("src/lib/mail-time.ts");
const sent = new Date("2026-10-26T12:00:00Z");

const HUAWEI_EXAM = "亲爱的同学，您好！ 感谢您应聘某公司，现邀请您参加线上考试 确认参加 放弃参加 考试信息 试卷名称： 【某公司校园招聘 硬件】 考试时间： (UTC+08:00) 2026-10-28 19:00:00 ~ 2026-10-28 20:00:00 考试时长： 60 min 考试链接： 请点击进入链接 https://exam.example.com/iexam/123/open/examInfo?examId=456 （如考试要求使用客户端）";
const HUAWEI_ASSESS = "亲爱的同学， 您好！欢迎参加某公司招聘，现邀请您进行在线测评，请您于2026-10-30 00:00:00 之前完成综合测评。 测评网址：https://test.example.org/exam/session/1/cn/#/login?permit=X&auto_login=2 测评答题时长限制为60分钟";
const PG_INTERVIEW = "恭喜您进入【Campus Recruiting - Operations Manager】职位的面试，具体面试安排如下，期待与您见面！* 面试方式：Video interview* 面试时间：October 30, 2026 Friday 14:00 (GMT+8)* 面试地点/链接：https://meet.example.com/l/meetup-join/abc/0?context=x（Number: 123456789） 如有问题，请联系";
const PG_SELECT = "我们的面试采用分批自主预约制 Click on the link to go Note: Our available appointment time is until \"Appointment Deadline Time (2026-10-30 23:59)\". Please make your selection before this time";
const TI_BOOK = "同学，您已经选择时间成功。 注：我们的可预约时间截止至「可预约期限时间（2026年10月30日下午4点00分）」，请您务必在此时间前进行选择";

test("a 笔试 with its time in the mail: the slot, its end, the zone and the link", () => {
  const found = plain(extractMailTime({ subject: "诚邀您参加华为公司在线笔试", body: HUAWEI_EXAM, mailDate: sent, exam: true }));
  assert.equal(found.kind, "slot");
  assert.equal(found.localStart, "2026-10-28T19:00");
  assert.equal(found.localEnd, "2026-10-28T20:00");
  assert.equal(found.timeZone, "Asia/Shanghai");
  assert.match(found.meetingUrl, /^https:\/\/exam\.example\.com\/iexam\//);
});

test("「…之前完成」 is a deadline, and midnight belongs to the day before", () => {
  const found = plain(extractMailTime({ subject: "诚邀您参加华为公司在线测评", body: HUAWEI_ASSESS, mailDate: sent, exam: true }));
  assert.equal(found.kind, "deadline");
  assert.equal(found.deadline, "2026-10-29T23:59");
  assert.match(found.meetingUrl, /^https:\/\/test\.example\.org\//);
});

test("an English date with GMT+8 is a slot in Shanghai time, with the meeting link", () => {
  const found = plain(extractMailTime({ subject: "Interview invitations from P&G", body: PG_INTERVIEW, mailDate: sent }));
  assert.equal(found.kind, "slot");
  assert.equal(found.localStart, "2026-10-30T14:00");
  assert.equal(found.timeZone, "Asia/Shanghai");
  assert.match(found.meetingUrl, /^https:\/\/meet\.example\.com\//);
});

test("self-booking mails give the last day to pick a slot, not an interview time", () => {
  const pg = plain(extractMailTime({ subject: "Interview Time Selection from P&G", body: PG_SELECT, mailDate: sent }));
  assert.equal(pg.kind, "booking");
  assert.equal(pg.deadline, "2026-10-30T23:59");
  const ti = plain(extractMailTime({ subject: "预约面试成功", body: TI_BOOK, mailDate: sent }));
  assert.equal(ti.kind, "booking");
  assert.equal(ti.deadline, "2026-10-30T16:00");
  // …but once a slot is booked that date is of no use: nothing goes on the calendar.
  assert.equal(completeMailDraft({ ai: null, subject: "预约面试成功", body: TI_BOOK, mailDate: sent, type: "面试邀请", company: "德州仪器" }), null);
});

test("dates without a year, 上午/下午 and a range", () => {
  const a = plain(extractMailTime({ subject: "面试通知", body: "面试时间：10月30日（周五）下午2:30-3:15 腾讯会议", mailDate: sent }));
  assert.equal(a.localStart, "2026-10-30T14:30");
  assert.equal(a.localEnd, "2026-10-30T15:15");
  const b = plain(extractMailTime({ subject: "面试通知", body: "您的面试时间：2027年1月5日 上午10:15", mailDate: new Date("2026-12-28T00:00:00Z") }));
  assert.equal(b.localStart, "2027-01-05T10:15");
  const c = plain(extractMailTime({ subject: "面试通知", body: "面试时间：1月5日 10:15", mailDate: new Date("2026-12-28T00:00:00Z") }));
  assert.equal(c.localStart, "2027-01-05T10:15");
});

test("offsets that are not whole hours are converted to UTC", () => {
  const found = plain(extractMailTime({ subject: "Interview", body: "Interview time: October 30, 2026 14:00 (UTC+05:30)", mailDate: sent }));
  assert.equal(found.localStart, "2026-10-30T08:30");
  assert.equal(found.timeZone, "UTC");
});

test("「48 小时内完成」 counts from the day the mail came", () => {
  const found = plain(extractMailTime({ subject: "在线测评", body: "请在48小时内完成测评，逾期无效", mailDate: new Date("2026-10-19T05:36:00Z"), exam: true }));
  assert.equal(found.kind, "deadline");
  assert.match(found.deadline, /^2026-10-2[01]T/);
});

test("nothing is invented from a mail without a time", () => {
  assert.equal(extractMailTime({ subject: "测评通知", body: "海康威视邀请你参加校园招聘在线测评，请点击链接 https://x.example/a", mailDate: sent, exam: true }), null);
  assert.equal(extractMailTime({ subject: "面试", body: "我们将于近期联系您安排面试，感谢关注。2026年10月26日 发", mailDate: sent }), null);
});

test("completeMailDraft keeps a usable AI time and fills in only what is missing", () => {
  const ai = { title: "新面试", localStart: "2026-10-30T10:15", localEnd: "", timeZone: "Asia/Shanghai", location: "", meetingUrl: "", evidence: "", deadline: "", windowStart: "" };
  assert.equal(plain(completeMailDraft({ ai, subject: "面试", body: "面试时间：2026-11-02 09:00", mailDate: sent, type: "面试邀请" })).localStart, "2026-10-30T10:15");
  const empty = { title: "华为在线笔试", localStart: "", localEnd: "", timeZone: "", location: "", meetingUrl: "", evidence: "", deadline: "", windowStart: "" };
  const filled = plain(completeMailDraft({ ai: empty, subject: "诚邀您参加华为公司在线笔试", body: HUAWEI_EXAM, mailDate: sent, type: "笔试通知", company: "华为" }));
  assert.equal(filled.title, "华为在线笔试");
  const untitled = plain(completeMailDraft({ ai: { ...empty, title: "" }, subject: "诚邀您参加华为公司在线笔试", body: HUAWEI_EXAM, mailDate: sent, type: "笔试通知", company: "华为" }));
  assert.equal(untitled.title, "华为 笔试");
  assert.ok(mailTime(filled));
  assert.equal(completeMailDraft({ ai: null, subject: "感谢投递", body: "我们已收到您的简历 2026-10-28 19:00", mailDate: sent, type: "进度更新" }), null);
});

test("a booking mail's title says what to do; the time is a deadline", () => {
  const invite = "同学，您好，恭喜您进入某公司线上面试环节！我们的面试采用自主预约制，请您通过以下引导进行面试预约。注：我们的可预约时间截止至「可预约期限时间（2026年10月30日下午4点00分）」，请您务必在此时间前进行选择";
  const draft = plain(completeMailDraft({ ai: { title: "德州仪器 Analog-FAE 岗位线上面试" }, subject: "德州仪器Analog-FAE岗位邀请您预约线上面试", body: invite, mailDate: sent, type: "面试邀请", company: "德州仪器" }));
  assert.equal(draft.booking, true);
  assert.match(draft.title, /^预约面试时间 · /);
  assert.equal(draft.localStart, "");
  assert.equal(draft.deadline, "2026-10-30T16:00");
  assert.ok(mailTime(draft) && mailTime(draft).hasTime === false);
});

test("cancellations, rejections and codes never give a time", () => {
  assert.equal(mailRulesOutTime("[P&G] Cancel Interview Notification 面试取消通知", "其他", ""), true);
  assert.equal(mailRulesOutTime("面试通知", "面试邀请", "很遗憾地通知您"), true);
  assert.equal(mailRulesOutTime("面试通知", "面试邀请", "面试时间：…"), false);
  assert.equal(completeMailDraft({ ai: null, subject: "面试取消通知", body: "面试时间：2026-10-30 14:00 已取消", mailDate: sent, type: "面试" }), null);
});

const { matchMailApplication } = loadTs("src/lib/mail-application-match.ts");
test("a mail that names the company in full finds the 投递 recorded by its short name", () => {
  const apps = [
    { id: "a", companyName: "德赛西威", title: "嵌入式软件工程师" },
    { id: "b", companyName: "华为", title: "硬件工程师" },
    { id: "c", companyName: "华为云", title: "云开发" },
    { id: "d", companyName: "TI", aliases: ["德州仪器"], title: "Analog-FAE" },
  ];
  assert.equal(matchMailApplication({ subject: "惠州市德赛西威汽车电子股份有限公司笔试邀请" }, apps), "a");
  assert.equal(matchMailApplication({ subject: "【华为公司】诚邀您参加华为公司在线笔试" }, apps), "b");
  assert.equal(matchMailApplication({ subject: "华为云校招笔试" }, apps), "c");
  assert.equal(matchMailApplication({ subject: "德州仪器Analog-FAE岗位邀请您预约线上面试" }, apps), "d");
  assert.equal(matchMailApplication({ subject: "Your entire application" }, apps), null);
  assert.equal(matchMailApplication({ subject: "某某公司面试" }, apps), null);
});

test("two 岗位 at one company need the mail to name the title", () => {
  const apps = [{ id: "x", companyName: "远景", title: "AI风机控制算法工程师" }, { id: "y", companyName: "远景", title: "储能系统工程师" }];
  assert.equal(matchMailApplication({ subject: "远景面试邀请" }, apps), null);
  assert.equal(matchMailApplication({ subject: "远景面试邀请", body: "岗位：AI风机控制算法工程师" }, apps), "x");
});

const { pendingMailRows } = loadTs("src/lib/pending-mail.ts");
test("the calendar's waiting list: times first, one line per company without one, nothing already scheduled", () => {
  const at = (hours) => new Date(sent.getTime() - hours * 3600_000);
  const draft = (extra) => ({ title: "x", localStart: "", localEnd: "", timeZone: "", location: "", meetingUrl: "", evidence: "", deadline: "", windowStart: "", ...extra });
  const tasks = [
    { id: "t1", title: "面试邀请：远景", note: "远景发来面试预约\n\n邮件主题：预约", mailEventDraft: draft({}), applicationId: "app-yj", createdAt: at(10) },
    { id: "t2", title: "面试邀请：德州仪器", note: "德州仪器邀请预约线上面试\n\n邮件主题：德州仪器邀请您预约", mailEventDraft: draft({}), applicationId: null, createdAt: at(3) },
    { id: "t3", title: "面试通知：德州仪器", note: "更早的一封", mailEventDraft: draft({}), applicationId: null, createdAt: at(30) },
    { id: "t4", title: "笔试通知：华为", note: "华为笔试", mailEventDraft: draft({ title: "华为笔试", deadline: "2026-10-29T23:59" }), applicationId: null, createdAt: at(8) },
    { id: "t5", title: "笔试通知：百度", note: "已过去的", mailEventDraft: draft({ title: "百度", deadline: "2026-10-20" }), applicationId: null, createdAt: at(80) },
    { id: "t6", title: "进度更新：腾讯", note: "只是进度", mailEventDraft: null, applicationId: null, createdAt: at(5) },
  ];
  const rows = plain(pendingMailRows(tasks, sent.getTime(), new Set(["app-yj"])));
  assert.deepEqual(rows.map((row) => row.id), ["t4", "t2"]);
  assert.equal(rows[0].type, "笔试通知");
  assert.equal(rows[0].company, "华为");
  assert.equal(rows[0].time.hasTime, false);
  assert.equal(rows[1].time, null);
  assert.equal(rows[1].subject, "德州仪器邀请您预约");
});

const { htmlToText, bodyTextOf } = loadTs("src/lib/mail-html-text.ts");
test("an HTML-only mail is read as text, with its links beside their words", () => {
  const html = '<html><head><style>p{color:red}</style></head><body><table><tr><td><p>您好！</p></td></tr><tr><td>考试时间：</td><td>(UTC+08:00) 2026-10-28 19:00:00 ~ 2026-10-28 20:00:00</td></tr><tr><td>考试链接：<a href="https://exam.example.com/iexam/1?x=1&amp;y=2">请点击进入链接</a></td></tr></table><img src="data:image/png;base64,AAAA"><a href="https://track.example.net/track/unsubscribe2.do?p=1">取消订阅</a></body></html>';
  const text = htmlToText(html);
  assert.match(text, /考试时间： \(UTC\+08:00\) 2026-10-28 19:00:00/);
  assert.match(text, /请点击进入链接 https:\/\/exam\.example\.com\/iexam\/1\?x=1&y=2/);
  assert.doesNotMatch(text, /color:red|track\\.example|base64/);
  const found = plain(extractMailTime({ subject: "笔试", body: text, mailDate: sent, exam: true }));
  assert.equal(found.localStart, "2026-10-28T19:00");
  assert.match(found.meetingUrl, /^https:\/\/exam\.example\.com\/iexam\/1\?x=1&y=2$/);
});

test("the plain part wins when it says something; a stub gives way to the HTML", () => {
  const long = "你好。".repeat(80);
  assert.equal(bodyTextOf(long, "<p>其他</p>"), long.trim());
  assert.equal(bodyTextOf("", "<p>面试时间：10月30日 14:00</p>"), "面试时间：10月30日 14:00");
  assert.equal(bodyTextOf("请使用 HTML 查看", "<p>面试时间：10月30日 14:00 腾讯会议</p>"), "面试时间：10月30日 14:00 腾讯会议");
  assert.equal(bodyTextOf(undefined, false), "");
  assert.equal(htmlToText("a&nbsp;b &#20013;&#x6587; &copy;"), "a b 中文 &copy;");
});
