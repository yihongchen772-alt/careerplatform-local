const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (name) => mocks[name] ?? require(name), console, Date, URLSearchParams });
  return mod.exports;
}
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const sheet = load("src/lib/campus-sheet.ts");
const day = (d) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null);

// A made-up row in the shape these 校招信息表 have.
const ROW = { id: "recTEST0001", cells: {
  公司: "银杏电子", 公司行业: "半导体、筛选前先看必读文档", 岗位: "芯片验证\n模拟IC设计", 届次: "2027届", 招聘类型: "秋招",
  工作地点: "上海、苏州、先看必读文档", 学历要求: "硕士起", 是否免笔试: "需要笔试", 投递链接: "投递：https://jobs.example.com/campus?id=1，内推码 ABC",
  公告链接: "https://mp.example.com/s/notice", 开始时间: "2026-10-30", 截止日期: "11.15", 备注: "可办户口", 招聘亮点: "双休",
} };

test("a sheet row becomes a posting: columns by name, helper options dropped, links pulled out", () => {
  const p = sheet.mapSheetRow(ROW, new Date(2026, 10, 2));
  assert.equal(p.company, "银杏电子");
  assert.equal(p.industry, "半导体");
  assert.equal(p.cities, "上海、苏州");
  assert.equal(p.applyUrl, "https://jobs.example.com/campus?id=1");
  assert.equal(p.noticeUrl, "https://mp.example.com/s/notice");
  assert.equal(day(p.startDate), "2026-10-30");
  assert.equal(day(p.deadline), "2026-11-15");
  assert.equal(p.cohort, "2027届");
  assert.match(p.note, /双休[\s\S]*可办户口/);
  assert.equal(sheet.columnKey("公司行业"), "industry", "公司行业 is not the company");
  assert.equal(sheet.mapSheetRow({ id: "x", cells: { 备注: "只有备注" } }), null, "no company, no posting");
});

test("a deadline with no year belongs to the season the row was posted in", () => {
  const start = new Date(2026, 8, 20);
  assert.equal(day(sheet.parseSheetDeadline("10.15", start)), "2026-10-15");
  assert.equal(day(sheet.parseSheetDeadline("3月1日", start)), "2027-3-1", "earlier than the start: next year");
  assert.equal(day(sheet.parseSheetDeadline("2026/12/31", start)), "2026-12-31");
  assert.equal(sheet.parseSheetDeadline("招满即停", start), null);
  assert.equal(day(sheet.parseSheetDeadline("招满即止，最晚11.30", start)), "2026-11-30");
});

test("a re-sync only touches rows that changed", () => {
  const a = sheet.mapSheetRow(ROW, new Date(2026, 10, 2));
  const { externalId, ...fields } = a;
  assert.equal(sheet.samePosting(fields, { ...fields, startDate: new Date(fields.startDate.getTime()) }), true);
  assert.equal(sheet.samePosting(fields, { ...fields, cities: "上海" }), false);
  assert.equal(externalId, "recTEST0001");
});

test("filters: my 届次 (or none written), past deadlines hidden, chips counted over the rest", () => {
  const q = load("src/lib/campus-postings-query.ts", { "@/lib/campus-sheet": sheet });
  const filters = q.readPostingFilters({ chip: "closing", q: "芯片 上海", page: "2" });
  assert.equal(filters.chip, "closing");
  assert.equal(filters.page, 2);
  const where = JSON.parse(JSON.stringify(q.baseWhere("u1", filters, 2027, new Date(2026, 10, 2))));
  const text = JSON.stringify(where);
  assert.match(text, /"cohort":null[^\]]*"contains":"2027届"/);
  assert.match(text, /"deadline":null/);
  assert.equal((text.match(/"company":\{"contains"/g) || []).length, 2, "each word searched");
  assert.equal(q.readPostingFilters({ chip: "evil" }).chip, "");
  assert.match(q.postingsHref(filters, { chip: "" }), /^\/leads\?view=postings&q=/);
});

test("the sheet is read in the desktop app only from 飞书 base links, and never backed up", () => {
  const reader = require("../electron/feishu-base.js");
  assert.equal(reader.isBaseLink("https://abc123.feishu.cn/base/AbCdEf123?from=from_copylink"), true);
  assert.equal(reader.isBaseLink("http://abc123.feishu.cn/base/AbCdEf123"), false);
  assert.equal(reader.isBaseLink("https://evil.example.com/base/AbCdEf123"), false);
  assert.match(read("electron/render-bridge.js"), /req\.url === "\/feishu-base"/);
  const action = read("src/lib/actions/campus-postings.ts");
  assert.match(action, /cleanLink\(String\(rawUrl/);
  assert.match(action, /!rows\.has\(row\.externalId\) && !row\.positionId/, "rows gone from the sheet go, unless added to the pool");
  assert.doesNotMatch(read("src/lib/backup-core.ts"), /"campusPosting"/);
  // The subscribed link is the user's own: none is written into the app.
  for (const file of ["src/lib/actions/campus-postings.ts", "src/components/leads/postings-controls.tsx", "electron/feishu-base.js"]) assert.doesNotMatch(read(file), /https:\/\/[a-z0-9]+\.feishu\.cn\/base\/[A-Za-z0-9]{10,}/);
});
