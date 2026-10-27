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
const { computeConversion, bestGroupLine } = loadTs("src/lib/analytics.ts");
const { pendingEvents, nudgeEvent, entrySchema } = loadTs("src/lib/journey.ts");

const app = (industry, stages, current, over = {}) => ({ industry, city: null, source: null, position: null, currentStage: current, stageHistory: stages.map((stage) => ({ stage })), ...over });
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

test("进面 means an interview round, not a 笔试: engaged and interviewed are different counts", () => {
  const rows = plain(computeConversion([
    app("半导体", ["APPLIED", "OA"], "OA"),
    app("半导体", ["APPLIED", "OA", "INTERVIEW_1"], "REJECTED"),
    app("半导体", ["APPLIED"], "APPLIED"),
  ]).byIndustry);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].total, rows[0].assessed, rows[0].interviewed, rows[0].engaged, rows[0].offers], [3, 2, 1, 2, 0]);
});

test("a rejected application that once had an interview still counts as having reached it", () => {
  const [row] = plain(computeConversion([app("汽车", ["APPLIED", "INTERVIEW_1", "REJECTED"], "REJECTED")]).byIndustry);
  assert.equal(row.interviewed, 1);
});

test("a step is never assumed: an offer with no recorded interview is not an interview", () => {
  const [row] = plain(computeConversion([app("汽车", ["APPLIED", "OFFER"], "OFFER")]).byIndustry);
  assert.deepEqual([row.interviewed, row.offers], [0, 1]);
});

test("groups without a label are left out; groups come from industry, city, source and track", () => {
  const out = plain(computeConversion([
    app("互联网", ["APPLIED"], "APPLIED", { city: "上海", source: "官网", position: { track: "后端" } }),
    app(null, ["APPLIED"], "APPLIED"),
  ]));
  assert.deepEqual([out.byIndustry.length, out.byCity.length, out.bySource.length, out.byTrack.length], [1, 1, 1, 1]);
});

test("a big group comes before a tiny one that happens to be 100%", () => {
  const apps = [
    ...many(6, (i) => app("互联网", ["APPLIED", ...(i < 3 ? ["INTERVIEW_1"] : [])], i < 3 ? "INTERVIEW_1" : "APPLIED")),
    app("机器人", ["APPLIED", "INTERVIEW_1"], "INTERVIEW_1"),
  ];
  const rows = plain(computeConversion(apps).byIndustry);
  assert.deepEqual(rows.map((r) => r.key), ["互联网", "机器人"]);
  assert.equal(rows[1].smallSample, true);
});

test("the plain-language line needs two solid groups; otherwise nothing is claimed", () => {
  const solid = (industry, interviewed) => many(5, (i) => app(industry, ["APPLIED", ...(i < interviewed ? ["INTERVIEW_1"] : [])], "APPLIED"));
  assert.equal(bestGroupLine(plain(computeConversion([...solid("互联网", 3), ...solid("汽车", 1)]).byIndustry)), "互联网进面最多：5 家里有 3 家（60%）");
  assert.equal(bestGroupLine(plain(computeConversion(solid("互联网", 3)).byIndustry)), null, "one group is nothing to compare");
  assert.equal(bestGroupLine(plain(computeConversion([...solid("互联网", 0), ...solid("汽车", 0)]).byIndustry)), null, "no interviews anywhere");
  assert.equal(bestGroupLine(plain(computeConversion([app("机器人", ["APPLIED", "INTERVIEW_1"], "APPLIED"), ...solid("汽车", 2), ...solid("互联网", 1)]).byIndustry)), "汽车进面最多：5 家里有 2 家（40%）", "a tiny group never headlines");
});

const NOW = new Date("2026-10-27T12:00:00Z").getTime();
const ev = (about, kind, hoursAgo) => ({ about, kind, at: new Date(NOW - hoursAgo * 3_600_000).toISOString() });

test("an event written about afterwards drops off the list; one written about before it does not", () => {
  const events = [ev("甲公司 · 未通过", "rejected", 5), ev("乙公司 · 一面", "interview", 30)];
  const after = [{ about: "甲公司 · 未通过", createdAt: new Date(NOW - 3_600_000).toISOString() }];
  assert.deepEqual(plain(pendingEvents(events, after)).map((e) => e.about), ["乙公司 · 一面"]);
  const before = [{ about: "甲公司 · 未通过", createdAt: new Date(NOW - 10 * 3_600_000).toISOString() }];
  assert.equal(pendingEvents(events, before).length, 2);
});

test("the dashboard nudge is a recent result only, never an interview, never older than two days", () => {
  assert.equal(nudgeEvent([ev("甲公司 · 一面", "interview", 2)], [], NOW), null);
  assert.equal(nudgeEvent([ev("甲公司 · 未通过", "rejected", 60)], [], NOW), null);
  assert.equal(nudgeEvent([ev("甲公司 · 未通过", "rejected", 20), ev("乙公司 · Offer", "offer", 4)], [], NOW).about, "乙公司 · Offer");
});

test("an entry needs text and a known mood", () => {
  assert.equal(entrySchema.safeParse({ mood: "down", text: "  " }).success, false);
  assert.equal(entrySchema.safeParse({ mood: "meh", text: "x" }).success, false);
  assert.equal(entrySchema.safeParse({ mood: "cry", text: "今天被拒了", about: "甲公司 · 未通过" }).success, true);
});
