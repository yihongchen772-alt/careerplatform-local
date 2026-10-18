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

const field = (label, section = "", extra = {}) => ({ id: `f-${label}-${section}`, label, placeholder: "", name: "", tag: "input", type: "text", section, ...extra });
// Values made inside the vm context have their own Array prototype.
const plain = (value) => JSON.parse(JSON.stringify(value));
const kind = (info) => (info ? `${info.group}:${info.kind}` : null);

test("语言成绩: exam boxes, a 语言能力 block and loose 语言分数 boxes fill from the saved exams", () => {
  const profile = { languages: [{ name: "CET-6", language: "", score: "560", date: "2023-06" }, { name: "雅思", language: "英语", score: "7.0", date: "2024-03" }] };
  const value = (f) => core.repeatFieldValue(f, core.resolveRepeatField(f, new Map()), profile);
  assert.equal(kind(core.resolveRepeatField(field("IELTS"), new Map())), "language:score");
  assert.equal(value(field("IELTS")), "7.0");
  assert.equal(value(field("雅思成绩")), "7.0");
  assert.equal(value(field("六级成绩")), "560");
  assert.equal(value(field("四级成绩")), null, "no CET-4 saved: nothing is made up");
  assert.equal(value(field("六级考试时间", "", { type: "month" })), "2023-06");
  assert.equal(value(field("语种", "语言能力", { tag: "select", options: ["英语", "日语", "法语"] })), "英语");
  assert.equal(value(field("考试类型", "语言能力", { tag: "select", options: ["大学英语四级", "大学英语六级", "雅思", "托福"] })), "大学英语六级");
  assert.equal(value(field("语言等级", "外语能力")), "CET-6 560");
  // 海尔: two 语言分数 boxes with no heading, one per saved exam in order.
  const rows = new Map();
  const first = field("* 语言分数"), second = { ...field("* 语言分数"), id: "second" };
  assert.equal(core.repeatFieldValue(first, core.resolveRepeatField(first, rows), profile), "560");
  assert.equal(core.repeatFieldValue(second, core.resolveRepeatField(second, rows), profile), "7.0");
  assert.equal(core.fieldModule(first, core.resolveRepeatField(first, new Map())), "basic");
  // Not language boxes.
  for (const label of ["英语水平", "姓名", "熟练程度", "是否通过六级"]) assert.notEqual(kind(core.resolveRepeatField(field(label), new Map())), "language:score", label);
  assert.equal(core.sectionGroup("教育背景及外语能力"), "education", "a mixed heading stays 教育");
  assert.equal(core.sectionGroup("语言能力"), "language");
});

test("语言成绩 falls back to the single 英语水平 text, read as exams", () => {
  assert.deepEqual(core.languageRows({ english: "CET-6 580，雅思 7.0" }).map((row) => [row.name, row.score]), [["CET-6", "580"], ["雅思", "7.0"]]);
  assert.deepEqual(core.languageRows({ english: "CET-6" }).map((row) => [row.name, row.score]), [["CET-6", ""]]);
  assert.deepEqual(core.languageRows({ english: "良好" }), []);
  assert.equal(core.repeatFieldValue(field("英语成绩"), core.resolveRepeatField(field("英语成绩"), new Map()), { english: "CET-6 580" }), "580");
  const profileLib = load("src/lib/application-profile.ts");
  assert.equal(profileLib.englishFromLanguages([{ name: "CET-6", language: "", score: "560", date: "" }, { name: "N2", language: "日语", score: "", date: "" }]), "CET-6 560");
  assert.equal(profileLib.languageLine({ name: "N2", language: "日语", score: "120", date: "2024-07" }), "日语 N2 120（2024-07）");
});

test("English portals: country of residence and English place names", () => {
  const sg = { currentCity: "新加坡" };
  assert.equal(core.matchFlatField(field("Country/region of residence", "", { tag: "select", options: ["China", "Singapore", "United States"] }), sg), "Singapore");
  assert.equal(core.matchFlatField(field("City, state, or country/region"), sg), "Singapore");
  assert.equal(core.matchFlatField(field("Country"), { currentCity: "上海市" }), "China");
  assert.equal(core.matchFlatField(field("所在国家"), { currentCity: "杭州" }), "中国");
  assert.equal(core.matchFlatField(field("Country"), { country: "Malaysia", currentCity: "上海" }), "Malaysia", "a saved country wins");
  assert.equal(core.matchFlatField(field("现居城市"), sg), "新加坡", "a Chinese form keeps Chinese");
  for (const label of ["Country code", "Country of birth", "Nationality", "Citizenship country"]) assert.equal(core.matchFlatField(field(label), sg), null, label);
  assert.equal(core.countryFromCity("火星"), null);
  assert.equal(core.learnableProfileKey(field("Country/region of residence")), "country");
});

test("待核对 backlog: 干部名称 + 层级 pairs become 校园经历, exam scores 语言成绩, facts fill blanks", () => {
  const backlog = load("src/lib/profile-backlog.ts");
  const learning = load("src/lib/profile-learning.ts");
  const answer = (id, label, value, extra = {}) => ({ id, kind: "answer", label, payload: { questionLabel: label, answer: value, kind: "field", ...extra } });
  const rows = [
    answer("a", "* 干部名称", "班级团支书"), answer("b", "* 干部层级", "班级"),
    answer("c", "* 干部名称", "学生会新媒体中心负责人"), answer("d", "* 干部层级", "院级"),
    answer("e", "* 语言分数", "475"), answer("f", "IELTS", "6.5"), answer("g", "研究方向", "强化学习控制"),
    answer("h", "（简答题）用过哪些AI工具？", "长文", { kind: "essay" }),
  ];
  const { answers, records } = backlog.backlogCaptures(rows);
  assert.deepEqual(plain(answers.map((item) => [item.profileKey, item.rowId])), [["researchDirection", "g"]]);
  assert.deepEqual(plain(records.map((record) => [record.category, record.content.name, record.content.level || record.content.score, record.rowIds.join("")])), [["language", "雅思", "6.5", "f"], ["campus", "班级团支书", "班级", "ab"], ["campus", "学生会新媒体中心负责人", "院级", "cd"]]);
  const base = { education: [], experiences: [], projects: [], awards: [{ name: "奖学金" }], campus: [], skills: [], languages: [], extras: {}, variants: [], learned: [] };
  const result = learning.learnFromPage(base, { preferredCities: null }, { answers, records, sourceUrl: "https://maker.haier.net/apply", variantActive: false, effectiveExtras: {}, memories: [] });
  assert.equal(result.profile.extras.researchDirection, "强化学习控制");
  assert.deepEqual(plain(result.profile.campus.map((row) => [row.role, row.level])), [["班级团支书", "班级"], ["学生会新媒体中心负责人", "院级"]]);
  assert.deepEqual(plain(result.profile.languages.map((row) => [row.name, row.score])), [["雅思", "6.5"]]);
  assert.equal(result.learned.length, 4);
  // 撤销 takes all of it back.
  const undone = learning.undoLearned(result.profile, { preferredCities: null }, result.learned.map((item) => item.id));
  assert.equal(undone.undone, 4);
  assert.equal(undone.profile.campus.length, 0);
  assert.equal(undone.profile.extras.researchDirection, undefined);
});
