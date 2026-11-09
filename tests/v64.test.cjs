const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// v1.64: synthetic fixtures only (fictional companies).
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, URL, process });
  return mod.exports;
}
const apps = [
  { id: "a1", title: "后端", currentStage: "APPLIED", companyName: "星河科技", aliases: ["Stellar"] },
  { id: "a2", title: "算法", currentStage: "APPLIED", companyName: "远山集团", aliases: [] },
];

test("an interview notice the AI called unrelated is rescued when it names an applied company", () => {
  const { rescueMail } = load("src/lib/mail-rescue.ts");
  const hit = rescueMail({ subject: "【星河科技】面试安排通知", from: "hr@example.test", snippet: "" }, apps);
  assert.equal(hit.applicationId, "a1");
  assert.equal(rescueMail({ subject: "Online assessment invitation", from: "Stellar Recruiting <r@example.test>", snippet: "" }, apps).applicationId, "a1");
  assert.equal(rescueMail({ subject: "笔试链接", from: "x@example.test", snippet: "远山集团 校招笔试在 11 月 20 日" }, apps).applicationId, "a2");
});

test("marketing, surveys and mail about companies never applied to are not rescued", () => {
  const { rescueMail } = load("src/lib/mail-rescue.ts");
  assert.equal(rescueMail({ subject: "星河科技宣讲会面试技巧分享", from: "", snippet: "" }, apps), null);
  assert.equal(rescueMail({ subject: "星河科技面试体验问卷", from: "", snippet: "" }, apps), null);
  assert.equal(rescueMail({ subject: "无名公司面试通知", from: "", snippet: "" }, apps), null);
  assert.equal(rescueMail({ subject: "星河科技 十月账单", from: "", snippet: "" }, apps), null);
});
