const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const cache = {};
function loadTs(relative) {
  if (cache[relative]) return cache[relative];
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => (name.startsWith("@/") ? loadTs(`src/${name.slice(2)}.ts`) : require(name));
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: localRequire, Intl, Date, Math, Set, Map }, { filename: relative });
  return (cache[relative] = mod.exports);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const { mapApplicationRows, stageFromStatus, parseSheetDate } = loadTs("src/lib/application-import.ts");
const { isCalendarMailTask } = loadTs("src/lib/pending-mail.ts");

const NOW = new Date("2026-10-27T08:00:00Z");

test("status words map to a stage, and 「挂」 beats the round it happened in", () => {
  const cases = { "": "APPLIED", 已投递: "APPLIED", 简历筛选中: "SCREENING", 笔试: "OA", 在线测评: "ASSESSMENT", 一面: "INTERVIEW_1", 面试中: "INTERVIEW_1", 二面: "INTERVIEW_2", 终面: "INTERVIEW_3", "HR 面": "HR_INTERVIEW", 拿到offer: "OFFER", 已签约: "ACCEPTED", 二面挂了: "REJECTED", 简历挂: "REJECTED", 未通过: "REJECTED", 放弃: "WITHDRAWN", 拒了offer: "WITHDRAWN", 面试结束等通知: "INTERVIEW_1" };
  for (const [text, stage] of Object.entries(cases)) assert.equal(stageFromStatus(text), stage, text);
});

test("rows not yet applied are skipped, not imported", () => {
  for (const text of ["待投", "未投递", "还没投", "收藏", "准备投"]) assert.equal(stageFromStatus(text), "SKIP", text);
});

test("dates: with a year, without one (never in the future), Chinese, and an Excel day number", () => {
  assert.equal(parseSheetDate("2026-09-03", NOW), "2026-09-03");
  assert.equal(parseSheetDate("2026年9月3日", NOW), "2026-09-03");
  assert.equal(parseSheetDate("9/3", NOW), "2026-09-03");
  assert.equal(parseSheetDate("12/30", NOW), "2025-12-30");
  assert.equal(parseSheetDate("45566", NOW), "2024-10-01");
  assert.equal(parseSheetDate("2026-02-31", NOW), null);
  assert.equal(parseSheetDate("尽快", NOW), null);
});

const HEADER = ["序号", "公司名称", "公司行业", "岗位", "城市", "投递日期", "当前状态", "渠道", "备注"];
const SHEET = [
  ["我的秋招投递表"],
  HEADER,
  ["1", "甲公司", "半导体", "硬件工程师", "上海", "2026-09-03", "二面", "官网", "HR 很客气"],
  ["2", "乙公司", "互联网", "嵌入式开发", "杭州/上海", "9/10", "挂了", "内推", ""],
  ["3", "丙公司", "汽车", "测试工程师", "", "", "待投", "", ""],
  ["4", "甲公司", "半导体", "硬件工程师", "上海", "2026-09-03", "一面", "官网", ""],
  ["5", "丁公司", "", "", "深圳", "2026-09-15", "", "", ""],
  ["", "", "", "", "", "", "", "", ""],
];

test("a sheet with a banner row: header found, industry column ignored, duplicates and not-yet-applied skipped", () => {
  const sheet = plain(mapApplicationRows(SHEET, NOW));
  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.skipped, 2);
  const [first, second, third] = sheet.rows;
  assert.deepEqual([first.companyName, first.title, first.city, first.appliedDate, first.stage, first.source, first.note], ["甲公司", "硬件工程师", "上海", "2026-09-03", "INTERVIEW_2", "官网", "HR 很客气"]);
  assert.equal(second.stage, "REJECTED");
  assert.equal(second.appliedDate, "2026-09-10");
  assert.match(second.city, /杭州/);
  assert.deepEqual([third.companyName, third.title, third.stage, third.city], ["丁公司", "未注明岗位", "APPLIED", "深圳"]);
});

test("no company column: nothing is guessed", () => {
  assert.equal(mapApplicationRows([["岗位", "城市"], ["工程师", "上海"]], NOW), null);
});

test("a column named 投递日期 is the date, not the status", () => {
  const sheet = plain(mapApplicationRows([["公司", "投递日期", "投递状态"], ["甲公司", "2026-09-03", "笔试"]], NOW));
  assert.equal(sheet.rows[0].appliedDate, "2026-09-03");
  assert.equal(sheet.rows[0].stage, "OA");
});

const NOW_MS = NOW.getTime();
const task = (over) => ({ title: "面试邀请：甲公司", done: false, sourceMailKey: "a:1", mailEventDraft: null, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null, createdAt: new Date(NOW_MS - 86_400_000), ...over });

test("mail tasks the calendar looks after are kept out of 我的待办, others stay", () => {
  assert.equal(isCalendarMailTask(task({}), NOW_MS), true);
  assert.equal(isCalendarMailTask(task({ title: "回复 HR 的邮件" }), NOW_MS), false);
  assert.equal(isCalendarMailTask(task({ sourceMailKey: null }), NOW_MS), false);
  assert.equal(isCalendarMailTask(task({ mailUndoneAt: new Date() }), NOW_MS), false, "an undone one goes back to the list");
  assert.equal(isCalendarMailTask(task({ mailAppliedAt: new Date() }), NOW_MS), false);
  assert.equal(isCalendarMailTask(task({ done: true }), NOW_MS), false);
  assert.equal(isCalendarMailTask(task({ createdAt: new Date(NOW_MS - 60 * 86_400_000) }), NOW_MS), false, "older than the calendar's window");
  assert.equal(isCalendarMailTask(task({ title: "邮件", mailEventDraft: { localStart: "2026-10-30T14:00", title: "x" } }), NOW_MS), true, "a timed draft counts whatever the title");
});

test("several cities in one cell are kept whole, and read back as the same cities", () => {
  const { parseCities } = loadTs("src/lib/application-city.ts");
  const sheet = plain(mapApplicationRows([["公司", "城市"], ["甲公司", "北京/上海/深圳/杭州"]], NOW));
  assert.deepEqual(plain(parseCities(sheet.rows[0].city)), ["北京", "上海", "深圳", "杭州"]);
});
