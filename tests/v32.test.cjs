const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 日历读邮件：时间写法的覆盖。所有文本都是按常见写法合成的，不含真实邮件内容。
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
const { completeMailDraft } = loadTs("src/lib/mail-time-extract.ts");
const { pendingMailRows } = loadTs("src/lib/pending-mail.ts");

const read = (type, body, sent, subject = type) => completeMailDraft({ ai: null, subject, body, mailDate: new Date(sent), type, company: "某公司" });

test("预约制面试：「预约成功后将收到确认邮件」不是「已经预约成功」，预约截止时间读得出", () => {
  const draft = read("面试邀请", "恭喜进入某岗位的面试环节！此次面试采用自主预约制。预约面试截止时间：2026-10-27 14:00 请通过邮件底部链接预约。预约成功后，您将会收到【面试确认】邮件，请务必点击确认参加。", "2026-10-26T10:44:00Z");
  assert.ok(draft);
  assert.equal(draft.booking, true);
  assert.equal(draft.deadline, "2026-10-27T14:00");
});

test("真的已经约好的邮件（选择时间成功）仍然不取预约窗口的日期", () => {
  const draft = read("面试邀请", "同学，您已经选择时间成功。注：可预约时间截止至「可预约期限时间（2026年10月30日下午4点00分）」", "2026-10-26T10:44:00Z");
  assert.equal(draft, null);
});

test("测评有效期：「七日内有效」从「于…生效」那一刻算起", () => {
  const draft = read("测评通知", "本次测试邀请于2026年10月27日 03:11生效，自测评发起之日起七日内有效，请及时完成。", "2026-10-26T19:11:00Z");
  assert.ok(draft);
  assert.equal(draft.deadline, "2026-11-03T03:11");
});

test("测评有效期的其他写法：72h有效、3 天有效、有效期为 3 天、7 天内完成、十二小时内完成", () => {
  const at = (body) => read("测评通知", body, "2026-10-24T01:00:00Z");
  assert.ok(at("【必考-72h有效】某公司综合测评 请点击链接作答。")?.deadline.startsWith("2026-10-27"));
  assert.ok(at("您的测评链接3天有效，请尽快作答。")?.deadline.startsWith("2026-10-27"));
  assert.ok(at("链接有效期为3天，请登录作答。")?.deadline.startsWith("2026-10-27"));
  assert.ok(at("请在邮件收到的7天内完成测评。")?.deadline.startsWith("2026-10-31"));
  const twelve = at("请在十二小时内完成测评。");
  assert.ok(twelve && twelve.deadline > "2026-10-24T01:00");
});

test("只对笔试 / 测评读有效期：面试邮件里的「7 天内有效」不是面试时间", () => {
  assert.equal(read("面试通知", "您的面试邀请链接7天内有效，请点击确认。", "2026-10-24T01:00:00Z"), null);
});

test("「将于 / 定于 / 调整为」后面的日期是面试时间", () => {
  const draft = read("面试通知", "您的一面将于2026年10月30日 14:00 进行，请提前10分钟进入会议室。", "2026-10-26T01:00:00Z");
  assert.equal(draft?.localStart, "2026-10-30T14:00");
  const changed = read("面试时间调整", "原定面试时间已调整为2026年11月2日（周一）10:30，抱歉给您带来不便。", "2026-10-26T01:00:00Z");
  assert.equal(changed?.localStart, "2026-11-02T10:30");
});

test("宣讲会邀请也读时间", () => {
  const draft = read("宣讲会邀请", "诚邀您参加宣讲会！宣讲时间：11月3日 19:00-21:00 腾讯会议号：123-456-789", "2026-10-26T01:00:00Z");
  assert.equal(draft?.localStart, "2026-11-03T19:00");
  assert.equal(draft?.localEnd, "2026-11-03T21:00");
});

test("相对日期：「明天下午 3 点」「下周三 10:00」按发信那天算", () => {
  const tomorrow = read("面试通知", "您好，面试安排在明天下午3点，请准时参加。", "2026-10-26T04:00:00Z");
  assert.equal(tomorrow?.localStart, "2026-10-27T15:00");
  // 2026-10-26 是周一，下周三 = 11-04
  const nextWeek = read("面试通知", "面试时间为下周三 10:00，请准时参加。", "2026-10-26T04:00:00Z");
  assert.equal(nextWeek?.localStart, "2026-11-04T10:00");
});

test("没写时间的邮件仍然读不出（不编造）", () => {
  assert.equal(read("面试通知（AI面试）", "近期将委托第三方联系您参加AI面试，面试时间和注意事项将会另行通知", "2026-10-26T01:00:00Z"), null);
});

test("邮件里说「另行通知」的，在待处理里标成等通知；要自己约时间的不是", () => {
  const task = (id, company, note, evidence) => ({ id, title: `面试通知：${company}`, note, mailEventDraft: { title: "x", localStart: "", localEnd: "", timeZone: "", location: "", meetingUrl: "", evidence, deadline: "", windowStart: "" }, applicationId: null, createdAt: new Date("2026-10-26T01:00:00Z") });
  const rows = pendingMailRows([
    task("a", "甲公司", "面试时间将另行通知。\n邮件主题：招聘进程通知", "具体时间另行通知"),
    task("b", "乙公司", "请自行点链接约面试时间。\n邮件主题：请预约面试", "请预约"),
  ], new Date("2026-10-27T01:00:00Z").getTime(), new Set());
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.a.waiting, true);
  assert.equal(byId.b.waiting, false);
});
