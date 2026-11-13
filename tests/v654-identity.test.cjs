const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// v1.65.4: after one 网申 in a tab, the next one there was recorded as the previous job.
// Fictional sites and jobs only.
function loadTs(relative) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: (name) => (name.startsWith("@/") ? loadTs(`src/${name.slice(2)}.ts`) : require(name)), URL, fetch: async () => ({ ok: false, json: async () => ({}) }) });
  return mod.exports;
}
const { identifyApplication } = loadTs("src/lib/application-identity.ts");
const { recognizeApplication } = loadTs("src/components/browser/recognize-application.ts");
const { historyMarkAt, historySinceMark, recordedMark } = require("../electron/history-mark.js");

const page = (url, title) => ({ url, title });
// One tab: a Moka job applied to and recorded, then on to another company's 飞书 site.
const tab = [
  page("https://app.mokahr.example.invalid/campus-recruitment/xingyuan/1#/job/aaaa1111-2222-3333-4444-555566667777", "运控算法工程师 - 星远科技"),
  page("https://app.mokahr.example.invalid/campus-recruitment/xingyuan/1#/job/aaaa1111-2222-3333-4444-555566667777/apply", "星远科技 校园招聘"),
  page("https://beta.jobs.feishu.cn/607459/login?redirect_path=%2Fresume%2F7657083576261675307%2Fapply", "贝洛科技招聘"),
  page("https://beta.jobs.feishu.cn/607459/resume/7657083576261675307/apply", "贝洛科技招聘"),
  page("https://beta.jobs.feishu.cn/607459/resume/applied", "贝洛科技招聘"),
];

test("after a 网申 is recorded, its pages no longer name the next one's job", () => {
  const mark = historyMarkAt(tab, 1, true, 1000);
  const since = historySinceMark(mark, null, tab);
  assert.deepEqual(since.map((p) => p.url), tab.slice(2).map((p) => p.url));
  const result = identifyApplication({ url: tab[4].url, title: tab[4].title, text: "投递成功", siteName: null, history: since.slice(0, -1), fields: [] }, [], []);
  assert.notEqual(result.title, "运控算法工程师", "not the job from the tab's previous 网申");
  // Before the fix: the whole tab history named the Moka job.
  const before = identifyApplication({ url: tab[4].url, title: tab[4].title, text: "投递成功", siteName: null, history: tab.slice(0, -1), fields: [] }, [], []);
  assert.equal(before.title, "运控算法工程师");
});

test("a success seen but not recorded keeps its pages until the next send", () => {
  const mark = historyMarkAt(tab, 1, false, 1000);
  assert.equal(historySinceMark(mark, 900, tab).length, tab.length, "the dialog can still record that one");
  assert.equal(historySinceMark(mark, 2000, tab).length, 3, "a new form was sent: a new 网申");
  // The list shifted (old entries dropped): found again by address.
  assert.equal(historySinceMark(mark, 2000, tab.slice(1)).length, 3);
  assert.equal(historySinceMark(null, 2000, tab).length, tab.length);
});

test("a job's apply page and its detail page are the same job for the pool", () => {
  const pool = [{ id: "p9", companyName: "贝洛科技", title: "北京实习 智能制造", jdUrl: "https://beta.jobs.feishu.cn/607459/position/7657083576261675307/detail" }];
  const result = identifyApplication({ url: tab[4].url, title: tab[4].title, text: "投递成功", siteName: null, history: tab.slice(2, 4), fields: [] }, pool, []);
  assert.equal(result.positionId, "p9");
  const moka = [{ id: "m1", companyName: "星远科技", title: "运控算法工程师", jdUrl: tab[0].url }];
  assert.equal(identifyApplication({ url: tab[1].url, title: tab[1].title, text: "投递成功", siteName: null, history: [], fields: [] }, moka, []).positionId, "m1");
});

test("the job linked while filling gives way when the pages name another company", async () => {
  const pool = [{ id: "old", companyName: "星远科技", title: "运控算法工程师", jdUrl: tab[0].url }];
  const snapshot = { url: tab[4].url, title: "贝洛科技招聘", text: "投递成功", siteName: null, history: tab.slice(2, 4), fields: [{ label: "应聘岗位", value: "北京实习 智能制造" }], positionId: "old" };
  const found = await recognizeApplication(snapshot, pool, []);
  assert.notEqual(found.positionId, "old");
  assert.notEqual(found.title, "运控算法工程师");
  // Nothing contradicts it: the linked job stands.
  const same = await recognizeApplication({ ...snapshot, url: tab[1].url, title: "星远科技 校园招聘", history: [tab[0]], fields: [] }, pool, []);
  assert.equal(same.positionId, "old");
});

test("recording clears the tab's linked job, and the dialog follows the pages over a stale link", () => {
  const view = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
  assert.match(view, /tab\.historyMark = recordedMark\(tab\.historyMark, tab\.lastSendAt, nav\.getAllEntries\(\), nav\.getActiveIndex\(\)\);\s*\/\/[^\n]*\s*tab\.positionId = undefined;/);
  const dialog = fs.readFileSync(path.join(__dirname, "../src/components/browser/mark-applied-from-browser.tsx"), "utf8");
  assert.match(dialog, /useState\(initialRecognition \? initialRecognition\.positionId \|\| NEW : initialPositionId \|\| NEW\)/);
  assert.match(dialog, /if \(!open \|\| initialRecognition\) return;/);
});

test("recorded after the tab moved on: the mark stays at that 网申's success page", () => {
  const seen = historyMarkAt(tab, 1, false, 1000);
  // Now on the next job's page (index 3), nothing sent yet: recording keeps the success page as the end.
  const mark = recordedMark(seen, 900, tab, 3, 3000);
  assert.equal(mark.index, 1);
  assert.equal(mark.recorded, true);
  assert.equal(historySinceMark(mark, null, tab).length, 3, "the next job's own pages stay");
  // A new form was sent after that success: this is where it ends.
  assert.equal(recordedMark(seen, 2000, tab, 3, 3000).index, 3);
  assert.equal(recordedMark(null, null, tab, 4, 3000).index, 4);
});

test("a 投递 recorded before 08:00: its date-only 已投递 still comes first in the timeline", () => {
  const { orderStageHistory } = loadTs("src/lib/stage-order.ts");
  const applied = new Date("2027-03-03T00:00:00.000Z"); // date-only = 08:00 in UTC+8
  const rows = [
    { id: "b", stage: "ASSESSMENT", enteredAt: new Date("2027-03-02T21:18:00.000Z") }, // 05:18 local, same day
    { id: "a", stage: "APPLIED", enteredAt: applied },
    { id: "c", stage: "OA", enteredAt: new Date("2027-03-05T02:00:00.000Z") },
  ];
  assert.equal(orderStageHistory(rows, applied).map((row) => row.stage).join(","), "APPLIED,ASSESSMENT,OA");
  // A later 已投递 written by hand at a real time is not the baseline: it sorts by time.
  const again = [...rows, { id: "d", stage: "APPLIED", enteredAt: new Date("2027-03-04T03:00:00.000Z") }];
  assert.equal(orderStageHistory(again, applied).map((row) => row.id).join(","), "a,b,d,c");
});
