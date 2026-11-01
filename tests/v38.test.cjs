const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require, console, Date });
  return mod.exports;
}

const { furthestInterview, interviewBreakdown, filterCounts } = load("src/lib/application-filters.ts");
// Values from the vm realm compare as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const h = (...stages) => stages.map((stage) => ({ stage }));
const app = (currentStage, history) => ({ currentStage, currentStageDate: "2026-10-01T00:00:00.000Z", interviewReach: furthestInterview(currentStage, history) });

// Shapes of real 投递 paths, synthetic companies.
const apps = [
  app("REJECTED", h("APPLIED", "SCREENING", "ASSESSMENT", "INTERVIEW_1", "REJECTED")),
  app("REJECTED", h("APPLIED", "OA", "INTERVIEW_1", "REJECTED")),
  app("REJECTED", h("APPLIED", "INTERVIEW_1", "INTERVIEW_2", "REJECTED")),
  app("ACCEPTED", h("APPLIED", "INTERVIEW_1", "OFFER", "ACCEPTED")),
  app("INTERVIEW_1", h("APPLIED", "INTERVIEW_1")),
  app("INTERVIEW_2", h("APPLIED", "INTERVIEW_1", "INTERVIEW_2")),
  app("DECLINED", h("OFFER", "DECLINED")),
  app("APPLIED", h("INTERVIEW_1", "APPLIED")),
  app("REJECTED", h("APPLIED", "REJECTED")),
];

test("each 投递 counts at the last interview round it reached", () => {
  assert.deepEqual(plain(apps.map((a) => a.interviewReach)), ["INTERVIEW_1", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_1", "INTERVIEW_1", "INTERVIEW_2", null, null, null]);
  assert.equal(furthestInterview("REJECTED", h("APPLIED", "INTERVIEW_2", "INTERVIEW_1")), "INTERVIEW_2");
  assert.equal(furthestInterview("HR_INTERVIEW", h("APPLIED")), "HR_INTERVIEW");
});

test("进过面试 splits by round and outcome: 一面没过 and 二面没过 are apart", () => {
  const b = interviewBreakdown(apps);
  assert.equal(b.total, 6);
  assert.deepEqual(plain(b.rows.map((r) => r.label)), ["一面", "二面"]);
  assert.deepEqual(plain(b.rows[0].cells), { going: 1, failed: 2, offer: 1, closed: 0 });
  assert.deepEqual(plain(b.rows[1].cells), { going: 1, failed: 1, offer: 0, closed: 0 });
  assert.deepEqual(plain(b.columns.map((c) => c.key)), ["going", "failed", "offer"]);
  assert.equal(filterCounts(apps, Date.parse("2026-11-01")).interviewed, 6);
});
