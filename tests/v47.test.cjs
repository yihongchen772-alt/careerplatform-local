const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, URL });
  return mod.exports;
}
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

test("AI 面试 is a stage of its own, read before the human rounds", () => {
  const schedule = load("src/lib/interview-schedule.ts");
  for (const text of ["示例科技 AI面试邀请", "请于 11 月 5 日前完成 AI 视频面试", "HireVue interview invitation", "机器人面试通知"]) {
    assert.equal(schedule.stageFromText(text), "AI_INTERVIEW", text);
    assert.equal(schedule.kindFromText(text), "exam", `${text}：done within a window, like a 测评`);
  }
  assert.equal(schedule.stageFromText("技术一面邀请"), "INTERVIEW_1");
  assert.equal(schedule.scheduleKindOf("AI_INTERVIEW"), "exam");
  assert.ok(schedule.SCHEDULE_STAGES.includes("AI_INTERVIEW"));
  const labels = load("src/lib/stage-labels.ts");
  assert.equal(labels.STAGE_LABELS.AI_INTERVIEW, "AI 面试");
  assert.ok(labels.STAGE_ORDER.indexOf("AI_INTERVIEW") > labels.STAGE_ORDER.indexOf("OA") && labels.STAGE_ORDER.indexOf("AI_INTERVIEW") < labels.STAGE_ORDER.indexOf("INTERVIEW_1"));
  const sheet = load("src/lib/application-import.ts");
  assert.equal(sheet.stageFromStatus("AI面试"), "AI_INTERVIEW");
  assert.equal(sheet.stageFromStatus("一面"), "INTERVIEW_1");
});

test("AI 面试 counts with 测评/笔试, not as reaching an interview", () => {
  const analytics = read("src/lib/analytics.ts");
  assert.match(analytics, /const ASSESSMENT_STAGES: ApplicationStage\[\] = \["ASSESSMENT", "OA", "AI_INTERVIEW"\]/);
  assert.match(analytics, /const INTERVIEW_STAGES: ApplicationStage\[\] = \["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"\]/);
  assert.match(read("src/lib/application-filters.ts"), /const EXAM: ApplicationStage\[\] = \["ASSESSMENT", "OA", "AI_INTERVIEW"\]/);
  assert.match(read("src/components/applications/applications-board.tsx"), /stages: \["ASSESSMENT", "OA", "AI_INTERVIEW"\]/);
  // 「AI_INTERVIEW」 contains INTERVIEW: its checklist comes first.
  const workflow = load("src/lib/application-workflow.ts", { zod: require("zod") });
  assert.match(workflow.stageChecklist("AI_INTERVIEW")[1].title, /摄像头/);
  assert.match(workflow.stageChecklist("INTERVIEW_1")[0].title, /面试时间/);
  for (const file of ["src/lib/actions/inbox-scan.ts", "src/lib/actions/application-sync.ts"]) assert.match(read(file), /AI 面试[^\n]*→ AI_INTERVIEW/, file);
});

test("投递记录 can be put in an order of one's own, by dragging or with ↑↓", () => {
  const table = read("src/components/applications/applications-table.tsx");
  assert.match(table, /custom: "自定义（拖动）"/);
  assert.match(table, /return order == null \? -Infinity : order;/, "never placed: first");
  // Moves within the whole list, so rows a filter hides keep their places.
  assert.match(table, /const order = \[\.\.\.applications\]\.sort\(byCustomOrder\(placed\)\)/);
  assert.match(table, /application\/x-cp-application/);
  assert.match(table, /event\.key !== "ArrowUp" && event\.key !== "ArrowDown"/);
  const action = read("src/lib/actions/applications.ts");
  assert.match(action, /export async function reorderApplications[\s\S]*?where: \{ userId: user\.id, id: \{ in: order \} \}[\s\S]*?sortOrder: index/);
  assert.match(read("prisma/migrations/20261102200000_application_sort_order/migration.sql"), /ADD COLUMN "sortOrder" REAL/);
});
