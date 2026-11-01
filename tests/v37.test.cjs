const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

// Boxes typed by hand on 2026-11-01 (埃夫特 / 上海微电子 zhiye, 穹彻 飞书, 主线科技 Moka).
const field = (label, extra = {}) => ({ id: `f-${label}-${extra.section || ""}`, label, placeholder: "", name: "", tag: "input", type: "text", section: "", ...extra });
const basic = (f, profile, rows = new Map()) => core.matchBasicField(f, profile, rows);
const profile = {
  name: "林晓舟", rank: "前15%", wechat: "zoe_wx",
  education: [{ school: "复旦大学", major: "统计学", degree: "硕士", start: "2025-09", end: "2099-06" }],
  campus: [{ name: "研究生会", role: "学术部部长", level: "校级", description: "组织学术沙龙 12 场" }],
  languages: [{ name: "雅思", language: "", score: "7.0", date: "" }],
};
const LEVELS = ["一般", "良好", "熟练", "精通"];

test("成绩排名 dropdowns get the narrowest 前 N% bucket the saved rank fits in", () => {
  const options = ["前 5%", "前 10%", "前 20%", "前 30%", "其他"];
  assert.equal(basic(field("成绩排名", { tag: "custom-select", section: "教育经历", options }), profile), "前 20%");
  assert.equal(basic(field("成绩排名", { tag: "custom-select", section: "教育经历", options }), { ...profile, rank: "3/40" }), "前 10%");
  assert.equal(basic(field("成绩排名", { tag: "custom-select", section: "教育经历", options }), { ...profile, rank: "前 45%" }), "其他");
  // No 前 N% choices at all: nothing guessed.
  assert.equal(basic(field("成绩排名", { tag: "custom-select", options: ["优秀", "良好", "其他"] }), profile), null);
  assert.equal(basic(field("成绩排名"), profile), "前15%");
});

test("language levels are read from the exam, one per box in the same row", () => {
  const rows = new Map();
  const section = "语言能力";
  assert.equal(basic(field("语言类型", { tag: "select", section, options: ["英语", "日语"] }), profile, rows), "英语");
  for (const label of ["掌握程度", "听说", "读写"]) assert.equal(basic(field(label, { tag: "select", section, options: LEVELS }), profile, rows), "熟练", label);
  assert.equal(basic(field("精通程度", { tag: "select", section, options: ["入门", "日常会话", "商务会话", "母语"] }), profile), "商务会话");
  // A pass is 良好, a low score 一般, and never 精通 on its own.
  assert.equal(basic(field("掌握程度", { tag: "select", section, options: LEVELS }), { ...profile, languages: [{ name: "CET-6", score: "480" }] }), "良好");
  assert.equal(basic(field("掌握程度", { tag: "select", section, options: LEVELS }), { ...profile, languages: [{ name: "CET-4", score: "400" }] }), "一般");
  assert.equal(basic(field("掌握程度", { tag: "select", section, options: LEVELS }), { ...profile, languages: [{ name: "专八", score: "" }] }), "熟练");
  // A skill's 掌握程度 is still the skill's own level.
  assert.equal(basic(field("掌握程度", { tag: "select", section: "专业技能", options: LEVELS }), { ...profile, skills: [{ name: "Python", level: "精通" }] }), "精通");
});

test("「在校职务」 is a campus module and its 职务描述 is the description", () => {
  const rows = new Map();
  assert.equal(basic(field("职务名称", { section: "在校职务" }), profile, rows), "学术部部长");
  assert.equal(basic(field("职务描述", { tag: "textarea", section: "在校职务" }), profile, rows), "组织学术沙龙 12 场");
  assert.equal(basic(field("职务描述", { tag: "textarea", section: "校园经历" }), profile), "组织学术沙龙 12 场");
});

test("推荐方式 picks 无, and a student's 目前职位 is 学生", () => {
  assert.equal(basic(field("推荐方式", { tag: "radio", options: ["无", "内推", "大使推荐"] }), profile), "无");
  assert.equal(basic(field("推荐方式", { tag: "radio", options: ["内推", "大使推荐"] }), profile), null);
  assert.equal(basic(field("目前职位", { section: "个人信息" }), profile), "学生");
  assert.equal(basic(field("目前职位"), { ...profile, education: [{ school: "复旦大学", end: "2020-06" }], latestRole: "数据分析师" }), "数据分析师");
  assert.equal(basic(field("期望职位"), { ...profile, targetRole: "算法工程师" }), "算法工程师");
});
