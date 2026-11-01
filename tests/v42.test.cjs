const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require, console });
  return mod.exports;
}
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

test("v1.42: GUESSED_CITY filter, per-round interview filter, and citySource preservation", () => {
  const city = load("src/lib/application-city.ts");
  assert.equal(city.GUESSED_CITY, "推测的城市");

  const view = read("src/components/applications/applications-view.tsx");
  assert.match(view, /GUESSED_CITY/);
  assert.match(view, /activeRound/);
  assert.match(view, /app\.interviewReach === activeRound/);

  const overview = read("src/components/applications/applications-overview.tsx");
  assert.match(overview, /selectedRound/);
  assert.match(overview, /onFilter\("interviewed", round \?\? null\)/);

  const bar = read("src/components/applications/city-lookup-bar.tsx");
  assert.match(bar, /让小欧核对推测城市/);
  assert.match(bar, /看推测的/);

  const detail = read("src/app/(dashboard)/applications/[id]/page.tsx");
  assert.match(detail, /工作城市/);

  const appActions = read("src/lib/actions/applications.ts");
  assert.match(appActions, /cityChanged/);

  const scheduleActions = read("src/lib/actions/schedule.ts");
  assert.match(scheduleActions, /citySource: app\.citySource \?\? null/);
  assert.match(scheduleActions, /row\.citySource !== undefined \? \{ citySource: row\.citySource \} : \{\}/);
});

test("v1.42: 小欧 refreshes the page after saving and offers full-workspace tools & actions", () => {
  const chat = read("src/components/assistant/agent-chat.tsx");
  assert.match(chat, /router\.refresh\(\)/);
  assert.match(chat, /继续查下一批城市/);

  const tools = read("src/lib/agent/tools.ts");
  for (const name of ["filter_applications", "get_workspace_overview"]) {
    assert.match(tools, new RegExp(`name: "${name}"`));
    assert.match(tools, new RegExp(`case "${name}"`));
  }

  const { assistantActionSchema } = load("src/lib/assistant-shared.ts");
  for (const type of ["update_offer", "update_position", "add_calendar_event", "complete_calendar_event", "update_profile", "update_company_industry", "add_journey"]) {
    const res = assistantActionSchema.safeParse({ type, label: `测试 ${type}` });
    assert.equal(res.success, true, `${type} should be accepted by assistantActionSchema`);
  }
});
