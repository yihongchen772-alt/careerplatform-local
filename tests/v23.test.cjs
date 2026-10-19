const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const core = require("../electron/autofill-core.js");

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Buffer, URL, Intl, process });
  return mod.exports;
}
const field = (label, extra = {}) => ({ id: `f-${label}`, label, placeholder: "", name: "", tag: "input", type: "text", section: "", ...extra });
const noDb = { "@/lib/db": { db: {} } };

test("交换经历: a yes / no question follows what 网申资料 says, a text box gets the text", () => {
  const radio = field("* 是否有交换生经历", { tag: "radio", options: ["是", "否"] });
  assert.equal(core.matchFlatField(radio, { exchange: "无" }), "否");
  assert.equal(core.matchFlatField(radio, { exchange: "2023 春 某大学交换一学期" }), "是");
  assert.equal(core.matchFlatField(radio, {}), null, "nothing saved: not guessed");
  assert.equal(core.matchFlatField(field("交换经历"), { exchange: "2023 春 某大学交换一学期" }), "2023 春 某大学交换一学期");
  assert.equal(core.matchFlatField(field("是否接受海外派驻"), { exchange: "无" }), null);
  assert.equal(core.learnableProfileKey(radio), "exchange");
});

test("英文名 fills from 网申资料; 姓名 and first / last name boxes are untouched by it", () => {
  const profile = { name: "林晓舟", englishName: "Zoe Lin" };
  assert.equal(core.matchFlatField(field("英文名"), profile), "Zoe Lin");
  assert.equal(core.matchFlatField(field("English Name (if any)"), profile), "Zoe Lin");
  assert.equal(core.matchFlatField(field("姓名"), profile), "林晓舟");
  assert.equal(core.matchBasicField(field("First Name"), profile, new Map()), null);
  assert.equal(core.learnableProfileKey(field("英文名")), "englishName");
});

test("a school written with its abbreviation is the same school", () => {
  const memory = load("src/lib/application-memory.ts");
  assert.equal(memory.sameMemoryEntity("education", { school: "新加坡国立大学（NUS）", degree: "硕士" }, { school: "新加坡国立大学", degree: "硕士" }), true);
  assert.equal(memory.sameMemoryEntity("education", { school: "东南大学" }, { school: "东北大学" }), false);
});

test("待核对 boxes 网申资料 now fills by itself are cleared; others stay", () => {
  const backlog = load("src/lib/profile-backlog.ts", noDb);
  const answer = (label, value) => ({ kind: "answer", label, payload: { questionLabel: label, answer: value, kind: "field" } });
  const profile = { campus: [{ name: "学生会", role: "部长" }], awards: [{ name: "奖学金" }] };
  assert.equal(backlog.coveredByProfile(answer("* 是否担任学生干部", "是"), profile), true);
  assert.equal(backlog.coveredByProfile(answer("受到奖励", "奖学金"), profile), true);
  assert.equal(backlog.coveredByProfile(answer("校内活动", "学生会"), profile), true);
  assert.equal(backlog.coveredByProfile(answer("校内活动", "学生会"), { campus: [], awards: [] }), false);
  assert.equal(backlog.coveredByProfile(answer("英文名", "Zoe"), profile), false);
});
