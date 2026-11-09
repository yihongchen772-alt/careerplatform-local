const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

// v1.63.5: field layouts seen in another user's Windows 网申样本 (51job, Moka, zhiye, 智联, B 站).
let next = 0;
const field = (label, extra = {}) => ({ id: `f${next++}`, tag: "input", type: "text", label, placeholder: "", name: "", section: "", ...extra });
const select = (label, options, extra = {}) => field(label, { tag: "select", type: "select-one", options, ...extra });
const profile = {
  education: [
    { school: "复旦大学", major: "统计学", degree: "硕士", start: "2024-09", end: "2026-06" },
    { school: "南京大学", major: "数学与应用数学", degree: "本科", start: "2020-09", end: "2024-06" },
  ],
  experiences: [], projects: [{ name: "推荐系统", role: "负责人", responsibilities: "模型设计", description: "协同过滤" }], awards: [], campus: [], skills: [], languages: [],
};
const basic = (label, p = profile, extra = {}) => {
  const f = field(label, extra);
  const rule = core.BASIC_FIELD_RULES.find((r) => core.basicRuleMatches(r, f));
  return rule ? rule.get(p) : undefined;
};

test("51job: 省份→学校两个下拉同属一段，本科学历类型和其他学校不算学校或学历", () => {
  const fields = [
    select("毕业学校 *", ["北京", "上海", "江苏省"], { section: "教育经历" }),
    select("毕业学校 *", ["复旦大学", "南京大学"], { section: "教育经历" }),
    field("其他学校", { section: "教育经历" }),
    select("本科学历类型 *", ["全日制", "非全日制"], { section: "教育经历" }),
    select("本科毕业学校 *", ["北京", "上海", "江苏省"], { section: "教育经历" }),
    select("本科毕业学校 *", ["复旦大学", "南京大学"], { section: "教育经历" }),
  ];
  const { repeats } = core.classifyRepeatBlocks(fields, profile, "");
  const [province, school, other, type, bProvince, bSchool] = fields.map((f) => repeats.get(f.id));
  assert.equal(province.kind, "school");
  assert.equal(school.row, province.row, "the second dropdown is the same school, not the next one");
  assert.equal(other, undefined);
  assert.equal(type, undefined, "本科学历类型 asks 全日制 or not");
  assert.equal(bSchool.row, bProvince.row);
  assert.equal(bSchool.degreeHint, bProvince.degreeHint);
  assert.ok(core.isOtherChoiceBox(fields[2]) && core.isOtherChoiceBox(field("本科其他专业")));
  assert.equal(basic("本科学历类型 *"), "全日制");
});

test("Moka: 一行的「职责」是角色，「项目中职责」是职责描述", () => {
  const fields = [
    field("项目名称", { section: "项目经验" }),
    field("职责", { section: "项目经验" }),
    field("项目中职责", { section: "项目经验", tag: "textarea", type: "textarea" }),
  ];
  const { repeats } = core.classifyRepeatBlocks(fields, profile, "");
  assert.equal(repeats.get(fields[1].id).kind, "role");
  assert.equal(repeats.get(fields[2].id).kind, "responsibilities");
  assert.equal(repeats.get(fields[2].id).row, 0);
});

test("学制按起止日期算，选项写法不同也能对上", () => {
  const master = profile.education[0], bachelor = profile.education[1];
  assert.equal(core.studyYearsOption({ options: null }, master), "2年");
  assert.equal(core.studyYearsOption({ options: ["1年", "2年", "3年", "4年"] }, master), "2年");
  assert.equal(core.studyYearsOption({ options: ["二年制", "三年制", "四年制"] }, bachelor), "四年制");
  assert.equal(core.studyYearsOption({ options: ["两年", "三年"] }, master), "两年");
  assert.equal(core.studyYearsOption({ options: ["二年制", "三年制"] }, { start: "2024", end: "2026" }), null, "no months, no guess");
  const { repeats } = core.classifyRepeatBlocks([field("具体学制", { section: "教育经历" })], profile, "");
  assert.equal([...repeats.values()][0].kind, "years");
});

test("是否全日制问的是这段学习本身，毕业了也答；受教育类型是全日制", () => {
  assert.equal(basic("是否全日制"), "是");
  assert.equal(basic("受教育类型"), "全日制");
  const partTime = { ...profile, education: [{ school: "某大学", degree: "硕士", major: "管理", start: "2020-09", end: "2023-06", mode: "非全日制" }] };
  assert.equal(basic("是否全日制", partTime), "否");
  assert.equal(basic("是否为全日制在校学生"), null, "在校 still means studying now");
});
