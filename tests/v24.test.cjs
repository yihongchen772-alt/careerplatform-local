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
const f = (label, section, extra = {}) => ({ id: `${label}-${Math.random()}`, label, placeholder: "请输入", name: "", tag: "input", type: "text", section, ...extra });
const kind = (info) => (info ? `${info.group}:${info.kind}:${info.row}` : null);

test("美团 / 京东 labels: 校园经历名称、考试分数、语言考试成绩、项目链接、奖学金名称、评优表彰名称", () => {
  assert.equal(kind(core.resolveRepeatField(f("校园经历名称*", "校园经历"), new Map())), "campus:name:0");
  assert.equal(kind(core.resolveRepeatField(f("考试分数*", ""), new Map())), "language:score:0");
  assert.equal(kind(core.resolveRepeatField(f("语言考试成绩:", "", { tag: "textarea" }), new Map())), "language:name:0");
  assert.equal(kind(core.resolveRepeatField(f("语言考试成绩:", "", { maxLength: 6 }), new Map())), "language:score:0", "a short box is a single score, not the exam name");
  assert.equal(kind(core.resolveRepeatField(f("项目链接", "项目链接"), new Map())), "project:link:0");
  assert.equal(kind(core.resolveRepeatField(f("项目链接", ""), new Map())), "project:link:0");
  assert.equal(kind(core.resolveRepeatField(f("*奖学金名称:", ""), new Map())), "award:name:0");
  assert.equal(kind(core.resolveRepeatField(f("*评优表彰名称:", ""), new Map())), "award:name:0");
  assert.equal(core.resolveRepeatField(f("个人主页", ""), new Map()), null, "a homepage is not a project link");
});

test("奖学金 / 评优表彰 each take only their own kind of award, rows counted apart", () => {
  const profile = { awards: [{ name: "全国大学生数学建模竞赛一等奖" }, { name: "国家奖学金" }, { name: "校级优秀学生干部" }, { name: "东南大学校长奖学金" }] };
  const rows = new Map();
  const a = f("*奖学金名称:", ""), b = f("*奖学金名称:", ""), c = f("*评优表彰名称:", "");
  const infos = [a, b, c].map((field) => core.resolveRepeatField(field, rows));
  assert.deepEqual(infos.map((info) => info.pick), ["scholarship", "scholarship", "honor"]);
  assert.deepEqual([a, b, c].map((field, i) => core.repeatFieldValue(field, infos[i], profile)), ["国家奖学金", "东南大学校长奖学金", "校级优秀学生干部"]);
  assert.equal(core.repeatFieldValue(c, { ...infos[2], row: 1 }, profile), null, "no second honor saved: nothing guessed");
  // A plain 获奖项 keeps taking the list in order.
  const plain = core.resolveRepeatField(f("获奖项", "获奖情况"), new Map());
  assert.equal(core.repeatFieldValue(f("获奖项", "获奖情况"), plain, profile), "全国大学生数学建模竞赛一等奖");
});

test("项目链接 fills from the saved project, and is never sent to the AI", () => {
  const profile = { projects: [{ name: "甲项目", link: "https://example.invalid/a" }, { name: "乙项目" }] };
  const rows = new Map();
  const first = f("项目链接", "项目经历"), second = f("项目链接", "项目经历");
  const infos = [first, second].map((field) => core.resolveRepeatField(field, rows));
  assert.equal(core.repeatFieldValue(first, infos[0], profile), "https://example.invalid/a");
  assert.equal(core.repeatFieldValue(second, infos[1], profile), null);
  assert.equal(core.repeatFieldGoesToAi(infos[0], { projects: [] }), false);
});

test("a typed 项目链接 is kept with its project, and 网申资料 stores the link", () => {
  const profile = load("src/lib/application-profile.ts");
  const memory = load("src/lib/application-memory.ts");
  assert.equal(profile.projectSchema.parse({ name: "甲项目", link: " https://example.invalid/a " }).link, "https://example.invalid/a");
  assert.equal(profile.projectSchema.parse({ name: "甲项目" }).link, "");
  assert.equal(memory.memoryCaptureSchema.safeParse({ category: "project", content: { name: "甲项目", link: "https://example.invalid/a" } }).success, true);
  assert.equal(profile.mergeProjectRows([{ name: "甲项目", role: "", start: "", end: "", description: "", responsibilities: "", link: "" }], [{ name: "甲项目", role: "", start: "", end: "", description: "", responsibilities: "", link: "https://example.invalid/a" }])[0].link, "https://example.invalid/a");
});

test("手填计数只算你自己敲的框，不算一键填写填进去的", async () => {
  const fields = [
    { id: "c0-f0", label: "项目名称", section: "项目经历", blockKey: "a", tag: "input" },
    { id: "c0-f1", label: "项目角色", section: "项目经历", blockKey: "a", tag: "input" },
    { id: "c0-f2", label: "项目链接", section: "项目经历", blockKey: "a", tag: "input" },
  ];
  const state = { "c0-f0": { value: "甲项目", userEdited: false }, "c0-f1": { value: "负责人", userEdited: false }, "c0-f2": { value: "https://example.invalid/a", userEdited: true, editedAt: 1 } };
  let posted;
  const adapter = { url: () => "https://fixture.example/apply", stillOnPage: () => true, frames: async () => [0], getDrafts: () => [], setDrafts() {}, run: async (_, fn, args) => {
    if (fn === core.hasUserEditedFields) return true;
    if (fn === core.scanPageFields) return fields;
    if (fn === core.readFieldValues) return Object.fromEntries(args[0].map((id) => [id, state[id]]));
  }, api: async (_, init) => { posted = JSON.parse(init.body); return { ok: true, json: async () => ({ saved: 1, processed: 1 }) }; } };
  const result = await core.saveCorrectionsCore(adapter, undefined, false);
  assert.equal(result.handTyped, 1);
  assert.equal(posted.records[0].content.link, "https://example.invalid/a");
  assert.equal(posted.records[0].content.name, "甲项目");
});
