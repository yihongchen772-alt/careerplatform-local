const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

// v1.65.3: what was still left from another user's Windows 网申样本 (zhiye, Moka, B 站). Fictional data.
let next = 0;
const field = (label, extra = {}) => ({ id: `f${next++}`, tag: "input", type: "text", label, placeholder: "", name: "", section: "", ...extra });
const select = (label, options, extra = {}) => field(label, { tag: "select", type: "select-one", options, ...extra });
const custom = (label, extra = {}) => field(label, { tag: "custom-select", type: "", ...extra });
const abroad = {
  education: [
    { school: "新加坡国立大学", major: "机器人", degree: "硕士", start: "2024-08", end: "2026-06" },
    { school: "南京大学", major: "机械工程", degree: "本科", start: "2020-09", end: "2024-06" },
  ],
  experiences: [], projects: [], awards: [], campus: [], skills: [], languages: [{ name: "CET-6", language: "英语", score: "560", date: "2023-06" }],
  english: "CET-6 560", currentCity: "上海",
};
const home = { ...abroad, education: [{ school: "复旦大学", major: "统计学", degree: "硕士", start: "2024-09", end: "2026-06" }], currentCity: "新加坡" };
const fill = (f, p = abroad) => core.matchBasicField(f, p, new Map());
const ZHIYE_FORMS = ["全国普通高等院校全日制", "全国普通高等院校非全日制", "海外留学生"];

test("学习形式: a school abroad takes the form's 海外 choice; 全日制 never picks 非全日制", () => {
  assert.equal(fill(select("学习形式", ZHIYE_FORMS)), "海外留学生");
  assert.equal(fill(custom("学习形式")), "海外留学生", "options not read yet");
  assert.equal(fill(select("学习形式", ["全日制", "非全日制"])), "全日制", "no 海外 choice offered");
  assert.equal(fill(select("学习形式", ZHIYE_FORMS), home), "全国普通高等院校全日制");
  assert.equal(fill(select("最高学历学习形式", ZHIYE_FORMS)), "海外留学生", "not the degree 硕士");
});

test("教育经历 · 学习形式 and 学校所在国家/地区 follow each row's own school", () => {
  const rows = new Map();
  const seen = [];
  for (const block of ["b0", "b1"]) {
    core.matchBasicField(field("学校名称", { section: "教育经历", blockKey: `education:${block}` }), abroad, rows);
    seen.push(core.matchBasicField(select("学习形式", ZHIYE_FORMS, { section: "教育经历", blockKey: `education:${block}` }), abroad, rows));
    seen.push(core.matchBasicField(select("学校所在国家/地区", ["中国", "新加坡", "英国"], { section: "教育经历", blockKey: `education:${block}` }), abroad, rows));
  }
  assert.deepEqual(seen, ["海外留学生", "新加坡", "全国普通高等院校全日制", "中国"]);
  // Where the applicant lives is not where the school is.
  assert.equal(fill(select("学校所在国家/地区", ["中国", "新加坡"]), home), "中国");
  assert.equal(fill(select("国家/地区", ["中国", "新加坡"]), home), "新加坡", "the residence question still reads 现居城市");
  assert.notEqual(fill(field("国家奖学金", { section: "教育经历" })), "中国", "an award is not a country");
});

test("最高学历 rules answer only their own question", () => {
  assert.equal(fill(field("最高学历")), "硕士");
  assert.equal(fill(field("最高学历毕业院校")), "新加坡国立大学");
  assert.equal(fill(field("最高学历专业")), "机器人");
  assert.notEqual(fill(custom("最高学历学习形式")), "硕士");
});

test("是否X with 「X / 非X」 options, and score bands for an exam", () => {
  assert.equal(fill(select("是否全日制", ["全日制", "非全日制"], { section: "教育经历" }), home), "全日制");
  assert.equal(fill(select("是否全日制", ["统招全日制", "非全日制"], { section: "教育经历" }), home), "统招全日制");
  assert.equal(fill(select("是否全日制", ["是", "否"], { section: "教育经历" }), home), "是");
  assert.equal(fill(select("是否接受调剂", ["接受调剂", "不接受调剂"]), { ...home, acceptAdjust: "是" }), "接受调剂");
  assert.equal(fill(select("大学英语六级（CET-6）", ["0-424", "425-649", "650-710"], { section: "英语能力" })), "425-649");
  assert.equal(fill(select("六级成绩", ["425分以下", "425-549", "550分以上"], { section: "语言能力" })), "550分以上");
  assert.equal(fill(field("六级成绩", { section: "语言能力" })), "560", "a text box still gets the score");
});

test("a choice that reveals more boxes gets a second round, only for those boxes", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../electron/autofill-core.js"), "utf8");
  assert.match(source, /onlyKeys: \[\.\.\.fresh\]/);
  assert.match(source, /if \(onlyKeys && outside\.has\(field\.id\)\) return;/, "earlier rounds' results for other boxes stay");
  assert.match(source, /!options\.region && !onlyKeys && filled\.length && round < maxRounds/, "never from a follow-up round itself");
});

test("old Ant Design calendars are filled, and two of them in a row are one span", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../electron/autofill-core.js"), "utf8");
  assert.match(source, /async function pickAntCalendar\(el, value\)/);
  assert.match(source, /if \(antCalendar\) entry\.antCalendar = true;/);
  assert.match(source, /field\.rangePart = pair\[0\] === calendar \? "start" : "end";/);
});
