const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Fictional companies and jobs only; each case mirrors a shape of mail that was linked wrong.
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
function load(file) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`) : require(id)), process, console, Intl, Date, URL, Set, Map, JSON, Math, Number, String, RegExp, Array, Object, Promise, Error, Boolean, Symbol, parseInt, isNaN }, { filename: file });
  return mod.exports;
}

const match = load("src/lib/mail-application-match.ts");
const app = (id, companyName, title, aliases = []) => ({ id, companyName, title, aliases });

test("an AI pick at a company the mail never names gives way to the company it does name", () => {
  const active = [app("m1", "示例通信", "网络运维工程师"), app("m2", "示例通信", "需求分析工程师"), app("k1", "青松机械（上海）有限公司", "PLC电气工程师"), app("k2", "青松机械（上海）有限公司", "现场服务工程师")];
  const mail = { subject: "【温馨提示】青松机械2027届校招PLC电气工程师 - AI面试", company: "青松机械（上海）有限公司", summary: "提醒你尚未完成PLC电气工程师岗位的AI面试" };
  assert.equal(match.resolveMailApplication(mail, "m1", active), "k1");
  // The mail names no company you applied to (an English sign-off): the pick stands.
  assert.equal(match.resolveMailApplication({ subject: "Interview invitation", company: "Sample Comms" }, "m1", active), "m1");
  // A pick at the named company is kept as before.
  assert.equal(match.resolveMailApplication(mail, "k1", active), "k1");
});

test("the job a mail spells out wins, even when that 投递 is marked closed", () => {
  const active = [app("x", "示例电子", "测试开发工程师（XC）"), app("p", "示例电子", "系统工程师（EM）")];
  const all = [...active, app("v", "示例电子", "汽车电子测试开发工程师（VM）")];
  const mail = { subject: "来自示例电子的面试邀请", company: "示例电子", summary: "示例电子汽车电子测试开发工程师（VM）面试邀请，11月16日视频面试", jobTitle: "汽车电子测试开发工程师（VM）" };
  assert.equal(match.resolveMailApplication(mail, "x", active, all), "v");
  // Without the closed one on file, the AI's pick among the open ones stays.
  assert.equal(match.resolveMailApplication(mail, "x", active, active), "x");
  // The same title applied to twice: the open one, not an old closed copy.
  const twice = [...active, app("old", "示例电子", "测试开发工程师（XC）")];
  assert.equal(match.resolveMailApplication({ subject: "示例电子测试开发工程师面试", company: "示例电子", jobTitle: "测试开发工程师" }, "x", active, twice), "x");
});

test("a mail about another kind of job is not linked to the one 投递 at that company", () => {
  const active = [app("a", "示例技术", "运动控制算法工程师")];
  const mail = { subject: "[示例技术]面试邀请通知-【27校招 - 通用研发】软件测试工程师", company: "示例技术", jobTitle: "【27校招-通用研发】软件测试工程师" };
  assert.equal(match.resolveMailApplication(mail, "a", active), null, "the AI's pick");
  assert.equal(match.resolveMailApplication(mail, null, active), null, "the company match");
  // No job named, or a job of the same kind: linked as before.
  assert.equal(match.resolveMailApplication({ subject: "示例技术面试邀请", company: "示例技术" }, null, active), "a");
  assert.equal(match.resolveMailApplication({ subject: "示例技术面试邀请", company: "示例技术", jobTitle: "运动控制工程师" }, "a", active), "a");
});

test("job kinds: a category 投递 fits its kind, a title without a role word fits anything", () => {
  assert.equal(match.jobConflicts("软件测试工程师", "运动控制算法工程师"), true);
  assert.equal(match.jobConflicts("软件集成测试工程师", "上海校招正式技术 - 测试类"), false);
  assert.equal(match.jobConflicts("管培生", "运动控制算法工程师"), false);
  assert.equal(match.jobConflicts("机器人集成测试开发培训生", "机器人集成测试开发培训生"), false);
  assert.equal(match.jobConflicts("", "算法工程师"), false);
  assert.equal(match.jobConflicts("PLC电气工程师", "现场服务工程师"), false, "no shared word list on one side → no verdict");
});

test("the scan gives the AI short numbers for 投递 and reads them back", () => {
  const scan = read("src/lib/actions/inbox-scan.ts");
  assert.match(scan, /A\$\{i \+ 1\}：/);
  assert.match(scan, /\^\\s\*A\(\\d\+\)\\s\*\$/);
  assert.match(scan, /resolveMailApplication\(/);
  assert.doesNotMatch(scan, /或该公司只有这一条投递）时才填写/, "no longer told to link any mail to a company's only 投递");
});

test("a cut-off with a clock time is over at that time, not at the end of the day", () => {
  const { mailTime, mailTimeOver } = load("src/lib/mail-time.ts");
  const draft = (over) => ({ title: "", localStart: "", localEnd: "", timeZone: "Asia/Shanghai", location: "", meetingUrl: "", evidence: "", deadline: "", windowStart: "", booking: false, ...over });
  const timed = mailTime(draft({ deadline: "2027-03-10T17:00" }));
  assert.equal(new Date(mailTimeOver(timed)).toISOString(), "2027-03-10T09:00:00.000Z");
  const dayOnly = mailTime(draft({ deadline: "2027-03-10" }));
  assert.equal(new Date(mailTimeOver(dayOnly)).toISOString(), "2027-03-11T00:00:00.000Z");
  const midnight = mailTime(draft({ deadline: "2027-03-11T00:00" }));
  assert.equal(new Date(mailTimeOver(midnight)).toISOString(), "2027-03-11T00:00:00.000Z", "「24 点」 still ends the day");
});

test("a calendar invite titled 「新面试」 takes the mail's type and company; a link in LOCATION is the meeting link", () => {
  const { inviteTitle, parseCalendarInvite } = load("src/lib/mail-calendar.ts");
  assert.equal(inviteTitle("新面试", "面试邀请：示例电子"), "面试邀请：示例电子");
  assert.equal(inviteTitle("Microsoft Teams Meeting", "面试邀请：示例电子"), "面试邀请：示例电子");
  assert.equal(inviteTitle("示例电子 技术一面", "面试邀请：示例电子"), "示例电子 技术一面");
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:新面试", "DTSTART:20270316T063000Z", "DTEND:20270316T073000Z", "LOCATION:https://teams.example.com/meet/123?p=abc 无会议室", "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const draft = parseCalendarInvite(ics);
  assert.equal(draft.meetingUrl, "https://teams.example.com/meet/123?p=abc");
  assert.equal(draft.localStart, "2027-03-16T06:30");
});
