const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/lib/application-flow.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const flow = { exports: {} };
vm.runInNewContext(compiled, { module: flow, exports: flow.exports, require });
const { classifyPortalTransition, isExplicitRejectionStatus } = flow.exports;

test("portal can skip company-specific steps without inventing intervening stages", () => {
  assert.equal(classifyPortalTransition("APPLIED", "INTERVIEW_1"), "apply");
  assert.equal(classifyPortalTransition("ASSESSMENT", "OFFER"), "review");
});

test("unusual company ordering is surfaced for review, not silently discarded", () => {
  assert.equal(classifyPortalTransition("HR_INTERVIEW", "OA"), "review");
  assert.equal(classifyPortalTransition("INTERVIEW_2", "ASSESSMENT"), "review");
});

test("company rejection always needs confirmation and terminal decisions stay closed", () => {
  assert.equal(classifyPortalTransition("APPLIED", "REJECTED"), "review");
  assert.equal(classifyPortalTransition("INTERVIEW_2", "REJECTED"), "review");
  assert.equal(classifyPortalTransition("REJECTED", "OFFER"), "none");
  assert.equal(classifyPortalTransition("APPLIED", "DECLINED"), "none");
  assert.equal(classifyPortalTransition("OA", "OA"), "none");
});

test("explicit rejection wording is noticed, but silence is not treated as rejection", () => {
  for (const status of ["初筛未通过", "很遗憾，未录用", "流程终止", "Application unsuccessful"]) {
    assert.equal(isExplicitRejectionStatus(status), true, status);
  }
  for (const status of ["已投递", "暂未更新", "岗位下架", "两周未回复", "笔试已安排"]) {
    assert.equal(isExplicitRejectionStatus(status), false, status);
  }
});

test("analytics counts only stages that actually happened at each company", () => {
  const funnelSource = fs.readFileSync(path.join(__dirname, "../src/lib/funnel.ts"), "utf8");
  const funnelCompiled = ts.transpileModule(funnelSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const funnel = { exports: {} };
  vm.runInNewContext(funnelCompiled, { module: funnel, exports: funnel.exports, require });
  const apps = [
    { stageHistory: [{ stage: "APPLIED" }, { stage: "INTERVIEW_1" }] },
    { stageHistory: [{ stage: "APPLIED" }, { stage: "ASSESSMENT" }, { stage: "OA" }] },
  ];
  const result = funnel.exports.computeFunnel(apps);
  assert.equal(result.levels.find((level) => level.stage === "OA").count, 1);
  assert.equal(result.levels.find((level) => level.stage === "INTERVIEW_1").count, 1);
  assert.equal(funnel.exports.reachedStage(apps[0], funnel.exports.FUNNEL_STAGES.indexOf("OA")), false);
});

test("portal ownership requires an explicit link even after other portals are removed", () => {
  const scopeSource = fs.readFileSync(path.join(__dirname, "../src/lib/application-portal-scope.ts"), "utf8");
  const scopeCompiled = ts.transpileModule(scopeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const scopeModule = { exports: {} };
  vm.runInNewContext(scopeCompiled, { module: scopeModule, exports: scopeModule.exports, require });
  const { portalOwnsApplication } = scopeModule.exports;
  assert.equal(portalOwnsApplication("campus", "campus"), true);
  assert.equal(portalOwnsApplication("social", "campus"), false);
  assert.equal(portalOwnsApplication("campus", null), false);
});

test("background sync retries failed runs soon and never overlaps", () => {
  const { createApplicationSyncSchedule } = require("../electron/application-sync-schedule");
  const schedule = createApplicationSyncSchedule();
  const sixHours = 6 * 60 * 60 * 1000;
  assert.equal(schedule.begin(sixHours, 0), true);
  assert.equal(schedule.begin(sixHours, 1), false);
  schedule.finish(sixHours, false, 100);
  assert.equal(schedule.begin(sixHours, 100 + 14 * 60 * 1000), false);
  assert.equal(schedule.begin(sixHours, 100 + 15 * 60 * 1000), true);
  schedule.finish(sixHours, true, 2000000);
  assert.equal(schedule.begin(sixHours, 2000001), false);
  assert.equal(schedule.begin(0, 2000002), false);
  assert.equal(schedule.begin(sixHours, 2000003), true);
});

test("backfilled stages do not replace the newest event; same-day application is baseline", () => {
  const stageSource = fs.readFileSync(path.join(__dirname, "../src/lib/application-stage-history.ts"), "utf8");
  const stageCompiled = ts.transpileModule(stageSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const stageModule = { exports: {} };
  vm.runInNewContext(stageCompiled, { module: stageModule, exports: stageModule.exports, require });
  const appliedDate = new Date("2026-09-25T00:00:00.000Z");
  const history = [
    { id: "a", stage: "APPLIED", enteredAt: appliedDate },
    { id: "b", stage: "INTERVIEW_1", enteredAt: new Date("2026-09-24T21:00:00.000Z") },
    { id: "c", stage: "OA", enteredAt: new Date("2026-09-20T12:00:00.000Z") },
  ];
  assert.equal(stageModule.exports.latestStageEntry(history, appliedDate).stage, "INTERVIEW_1");
  assert.equal(stageModule.exports.latestStageEntry([history[0]], appliedDate).stage, "APPLIED");
});
