const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, URL });
  return mod.exports;
}
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

test("a meeting is said briefly: platform, number and notes, never the raw address", () => {
  const { meetingSummary } = load("src/lib/interview-schedule.ts");
  assert.equal(meetingSummary("https://example.webex.com/join/abc123 无会议室"), "Webex 会议 · 无会议室");
  assert.equal(meetingSummary("腾讯会议 https://meeting.tencent.com/dm/AbCd 会议号：123456789"), "腾讯会议 123 456 789");
  assert.equal(meetingSummary("https://example.feishu.cn/hire/short_url/xyz"), "飞书");
  assert.equal(meetingSummary("https://unknown.example.com/room/1"), "会议链接");
  assert.equal(meetingSummary("https://unknown.example.com/test/1", true), "测评链接");
  assert.equal(meetingSummary("线下：示例大厦 3 楼"), "线下 示例大厦 3 楼");
  assert.equal(meetingSummary(""), "");
  for (const file of ["src/components/schedule/upcoming-schedule.tsx", "src/components/applications/interview-hub.tsx", "src/components/applications/stage-timeline.tsx"]) assert.match(read(file), /meetingSummary\(/, file);
});

test("the sidebar is short; the rest is one click away on 工具箱", () => {
  const nav = read("src/components/dashboard/nav.tsx");
  const main = (nav.match(/\{ href: "\/[a-z-]+", label:/g) || []).length;
  assert.ok(main <= 11, `sidebar links (with 工具箱 and 设置): ${main}`);
  const tools = read("src/lib/nav-tools.ts");
  for (const href of ["/interviews", "/question-banks", "/companies", "/compare", "/contacts", "/library", "/journey", "/personality", "/resume-drill"]) assert.match(tools, new RegExp(`href: "${href}"`));
  assert.match(nav, /TOOL_LINKS\.some\(\(link\) => isActive\(link\.href\)\)/, "工具箱 lights up on its pages");
  assert.match(nav, /setMode\(dark \? "light" : "dark"\)/, "one-click light/dark");
  assert.match(read("src/app/(dashboard)/tools/page.tsx"), /from "@\/lib\/nav-tools"/);
});

test("投递记录 opens on the list: no second 接下来, the numbers in one row, the tables folded", () => {
  const page = read("src/app/(dashboard)/applications/page.tsx");
  assert.doesNotMatch(page, /<UpcomingSchedule/);
  const overview = read("src/components/applications/applications-overview.tsx");
  assert.match(overview, /"careerplatform\.applications\.overview\.v2", \["open", "closed"\] as const, "closed"\)/);
  assert.doesNotMatch(overview, /stat-tile/);
  assert.match(read("src/app/(dashboard)/layout.tsx"), /pb-28[\s\S]*mx-auto w-full max-w-\[110rem\]/);
});

test("上手四步: details, an AI, a 校招信息表, a first 一键填写", () => {
  const dashboard = read("src/app/(dashboard)/dashboard/page.tsx");
  for (const key of ["profile", "ai", "sheet", "fill"]) assert.match(dashboard, new RegExp(`key: "${key}"`));
  assert.match(dashboard, /done: sheetCount > 0 \|\| leadCount > 0/);
  assert.match(read("src/components/dashboard/onboarding-card.tsx"), /careerplatform\.onboarding\.v2\.dismissed/);
});
