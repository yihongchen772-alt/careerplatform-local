const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relative) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require, Math, Set, Map }, { filename: relative });
  return mod.exports;
}
const { computeShareStats, defaultHero, shareCardHtml, parseDirections } = loadTs("src/lib/share-card.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

const app = (companyName, currentStage, stages, industry = null) => ({ companyName, currentStage, stageHistory: stages.map((stage) => ({ stage })), industry });
const APPS = [
  app("甲公司", "OFFER", ["APPLIED", "OA", "INTERVIEW_1", "OFFER"], "半导体"),
  app("乙公司", "REJECTED", ["APPLIED", "INTERVIEW_1"], "半导体"),
  app("丙公司", "APPLIED", ["APPLIED"], "互联网"),
  app("丁公司", "DECLINED", ["APPLIED", "ASSESSMENT", "HR_INTERVIEW", "OFFER"], null),
  app("戊公司", "INTERVIEW_2", ["APPLIED"], "半导体"),
];

test("counts what was reached, from history or from where the 投递 sits now", () => {
  const stats = plain(computeShareStats(APPS));
  assert.equal(stats.applied, 5);
  assert.equal(stats.assessed, 2);
  assert.equal(stats.interviewed, 4);
  assert.equal(stats.offers, 2);
  assert.deepEqual(stats.offerCompanies, ["甲公司", "丁公司"]);
});

test("a declined offer still counts, a skipped step is not credited", () => {
  const stats = plain(computeShareStats([app("某公司", "DECLINED", ["APPLIED", "OFFER"])]));
  assert.equal(stats.offers, 1);
  assert.equal(stats.interviewed, 0);
  assert.equal(stats.assessed, 0);
});

test("industries: top three, no industry falls under 其他", () => {
  const stats = plain(computeShareStats(APPS));
  assert.deepEqual(stats.industries.map((row) => [row.name, row.count, row.pct]), [["半导体", 3, 60], ["互联网", 1, 20], ["其他", 1, 20]]);
});

test("the big number defaults to the best news", () => {
  assert.equal(defaultHero(computeShareStats(APPS)), "offers");
  assert.equal(defaultHero(computeShareStats([app("X", "INTERVIEW_1", ["APPLIED"])])), "interviewed");
  assert.equal(defaultHero(computeShareStats([app("X", "APPLIED", ["APPLIED"])])), "applied");
  assert.equal(defaultHero(computeShareStats([])), "applied");
});

test("the card shows the numbers, escapes text, and hides company names unless asked", () => {
  const stats = computeShareStats(APPS);
  const options = { title: "<b>战绩</b>", name: "小陈", cohort: "2027 届", directions: ["硬件", "产品"], hero: "offers", section: "funnel", showOfferCompanies: false };
  const html = shareCardHtml(stats, options);
  assert.match(html, /&lt;b&gt;战绩&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>战绩/);
  assert.match(html, /@ 小陈/);
  assert.match(html, /2027 届/);
  assert.match(html, /class="num"[^>]*>2</);
  assert.match(html, /Offer 转化率 40%/);
  assert.doesNotMatch(html, /甲公司/);
  const withNames = shareCardHtml(stats, { ...options, showOfferCompanies: true });
  assert.match(withNames, /甲公司、丁公司/);
  assert.match(shareCardHtml(stats, { ...options, section: "industry" }), /半导体/);
});

test("an empty list still draws a card", () => {
  const html = shareCardHtml(computeShareStats([]), { title: "", name: "", cohort: "", directions: [], hero: "applied", section: "industry", showOfferCompanies: false });
  assert.match(html, /我的求职战绩/);
  assert.match(html, /还没有投递记录/);
});

test("directions split on spaces and commas, at most five", () => {
  assert.deepEqual(plain(parseDirections("硬件 嵌入式，产品、运营/测试 硬件 算法")), ["硬件", "嵌入式", "产品", "运营", "测试"]);
});
