const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Intl, process });
  return mod.exports;
}

const { recognizeSchedule, companyCore, titleWithoutCompany } = load("src/lib/schedule-recognize.ts");
const { dashboardBrief } = load("src/lib/dashboard-brief.ts");

const event = (title, startsAt, extra = {}) => ({ key: `event:${title}`, source: "event", sourceId: title, kind: /测评|笔试/.test(title) ? "exam" : /面试/.test(title) ? "interview" : "event", startsAt, endsAt: null, hasTime: true, title, applicationId: null, companyName: null, jobTitle: null, meetingInfo: null, fromMail: true, ...extra });
const stage = (companyName, title, startsAt, extra = {}) => ({ key: `stage:${companyName}`, source: "stage", sourceId: companyName, kind: "interview", startsAt, endsAt: null, hasTime: true, title, applicationId: `app-${companyName}`, companyName, jobTitle: "岗位", meetingInfo: null, ...extra });
const apps = [
  { id: "app-多场科技", companyName: "多场科技", title: "减振控制工程师" },
  { id: "byd-1", companyName: "比亚迪", title: "高级算法工程师" },
  { id: "byd-2", companyName: "比亚迪", title: "高级仿真工程师" },
  { id: "hik", companyName: "海康威视", title: "机器人底盘控制算法工程师" },
  { id: "cmcc", companyName: "中国移动", aliases: ["中国移动通信集团北京有限公司"], title: "需求分析工程师" },
];

test("the mail's own calendar copy of an interview already on its 投递 is not listed twice", () => {
  const items = [
    stage("多场科技", "面试", "2026-10-29T07:00:00.000Z"),
    event("多场低温科技（北京）有限公司【2027校招】运动控制算法工程师 面试", "2026-10-29T07:00:00.000Z"),
  ];
  const out = recognizeSchedule(items, apps);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "stage");
  // A different time is another sitting and stays.
  assert.equal(recognizeSchedule([items[0], { ...items[1], startsAt: "2026-10-30T07:00:00.000Z" }], apps).length, 2);
  assert.equal(companyCore("多场低温科技（北京）有限公司"), "多场低温");
});

test("an unlinked 测评 names its company and the 投递 it most likely belongs to", () => {
  const [hik] = recognizeSchedule([event("海康威视校园招聘在线测评（截止）", "2026-11-03T00:00:00.000Z", { hasTime: false })], apps);
  assert.equal(hik.companyName, "海康威视");
  assert.equal(hik.title, "校园招聘在线测评（截止）");
  assert.equal(JSON.stringify(hik.suggestion), JSON.stringify({ applicationId: "hik", label: "海康威视 · 机器人底盘控制算法工程师" }));
  // Two 投递 at 比亚迪: the company is named, the choice left to the user…
  const [byd] = recognizeSchedule([event("比亚迪校园招聘线上测评（截止）", "2026-11-03T00:00:00.000Z", { hasTime: false })], apps);
  assert.equal(byd.companyName, "比亚迪");
  assert.equal(byd.suggestion, null);
  assert.equal(byd.companyApplications, 2);
  // …unless the invitation repeats one job's title.
  const [named] = recognizeSchedule([event("比亚迪 高级仿真工程师 笔试", "2026-11-03T11:00:00.000Z")], apps);
  assert.equal(named.suggestion.applicationId, "byd-2");
  // A legal-name alias still counts.
  const [cmcc] = recognizeSchedule([event("中国移动通信集团北京有限公司职位胜任力测评", "2026-11-02T00:00:00.000Z", { hasTime: false })], apps);
  assert.equal(cmcc.companyName, "中国移动");
  assert.equal(cmcc.title, "职位胜任力测评");
  // Nobody named: unchanged.
  const [gym] = recognizeSchedule([event("健身", "2026-11-02T10:00:00.000Z", { fromMail: false })], apps);
  assert.equal(gym.companyName, null);
});

test("a title that is nearly only the company keeps its words", () => {
  assert.equal(titleWithoutCompany("比亚迪 面试", "比亚迪"), "比亚迪 面试");
  assert.equal(titleWithoutCompany("比亚迪校园招聘线上测评", "比亚迪"), "校园招聘线上测评");
  assert.equal(titleWithoutCompany("测评 · 比亚迪", "比亚迪"), "测评 · 比亚迪");
});

test("总览's line: a 测评 window is not the next 「场」, and quiet 投递 are not pressing", () => {
  const now = new Date(2026, 10, 1, 23, 0).getTime();
  const upcoming = [
    event("比亚迪校园招聘线上测评（截止）", "2026-11-03T00:00:00.000Z", { hasTime: false, companyName: "比亚迪", title: "校园招聘线上测评（截止）" }),
    stage("德州仪器", "一面", new Date(2026, 10, 3, 13, 30).toISOString()),
    stage("经纬恒润", "一面", new Date(2026, 10, 4, 16, 30).toISOString()),
  ];
  const todos = [
    { id: "stale-1", label: "", sublabel: "", urgency: "overdue", href: "", order: 0, staleDays: 20 },
    { id: "next-1", label: "", sublabel: "", urgency: "urgent", href: "", order: 0 },
  ];
  const brief = dashboardBrief(upcoming, todos, now);
  assert.match(brief[0], /^下一场 后天 13:30 德州仪器 · 一面$/);
  assert.equal(brief[1], "7 天内 2 场");
  assert.match(brief[2], /^1 个测评 \/ 截止待完成 · 最早 比亚迪 后天$/);
  assert.equal(brief.at(-1), "1 件事今明两天要处理");
  // Today first.
  const morning = new Date(2026, 10, 3, 9, 0).getTime();
  assert.match(dashboardBrief(upcoming, [], morning)[0], /^今天 13:30 德州仪器 · 一面$/);
  assert.equal(dashboardBrief([], [], now)[0], "7 天内没有约好的面试 / 笔试");
});
