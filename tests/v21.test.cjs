const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

const field = (label, section = "", extra = {}) => ({ label, placeholder: "", name: "", tag: "input", type: "text", section, ...extra });
const kind = (info) => (info ? `${info.group}:${info.kind}` : null);

test("labels typed by hand after v1.20 map to the 网申资料 field they would fill", () => {
  const expected = {
    研究方向: "researchDirection", "QQ号*": "qq", "作品链接*": "homepage", 个人主页链接: "homepage", "期望工作地点 *": null, 期望岗位: null,
    "是否接受岗位调剂*": "acceptAdjust", "接受调剂*": "acceptAdjust", "本科学习成绩排名 *": "rank", 实验室: "lab", "个人爱好*": "hobbies",
    "毕业论文简介*": "thesis", 政治面貌: "politics",
    // Not 网申资料 facts, or not the applicant's: nothing is learned.
    "工作地是否可接受潍坊*": null, 户口原籍具体地址: null, "所在校区*": null, 姓名: null, 英语成绩: null, 紧急联系人电话: null, 公司名称: null,
  };
  for (const [label, key] of Object.entries(expected)) assert.equal(core.learnableProfileKey(field(label)), key, label);
});

test("专业技能 rows: name, level, category; language levels and certificates stay out", () => {
  assert.equal(kind(core.resolveRepeatField(field("技能名称", "专业技能"), new Map())), "skill:name");
  assert.equal(kind(core.resolveRepeatField(field("掌握程度", "专业技能", { tag: "select", options: ["一般", "良好", "熟练", "精通"] }), new Map())), "skill:level");
  assert.equal(kind(core.resolveRepeatField(field("技能类别"), new Map())), "skill:category");
  assert.equal(kind(core.resolveRepeatField(field("专业技能", "", { tag: "textarea" }), new Map())), "skill:summary");
  assert.equal(core.resolveRepeatField(field("熟练程度", "语言能力", { tag: "select", options: ["一般", "良好"] }), new Map()), null);
  assert.equal(core.resolveRepeatField(field("使用时长", "专业技能"), new Map()), null);
  assert.equal(core.sectionGroup("技能证书"), null);
  assert.equal(core.fieldModule(field("技能名称", "专业技能"), core.resolveRepeatField(field("技能名称", "专业技能"), new Map())), "skill");
  // A saved level finds the nearest step among the page's own words.
  assert.equal(core.skillLevelOption({ options: ["一般", "良好", "熟练", "精通"] }, "熟悉"), "良好");
  assert.equal(core.skillLevelOption({ options: ["一般", "较熟练", "熟练", "精通"] }, "较熟练"), "较熟练");
  assert.equal(core.skillLevelOption({ options: ["了解", "熟悉", "掌握", "精通"] }, "熟练"), "掌握");
  const profile = { skills: [{ name: "Python", level: "熟练", category: "编程语言" }, { name: "Tableau", level: "熟悉", category: "软件工具" }] };
  const fields = [
    { id: "a", blockKey: "skill:1", ...field("技能名称", "专业技能") }, { id: "b", blockKey: "skill:1", ...field("掌握程度", "专业技能") },
    { id: "c", blockKey: "skill:2", ...field("技能名称", "专业技能") }, { id: "d", blockKey: "skill:2", ...field("掌握程度", "专业技能") },
  ];
  const { repeats } = core.classifyRepeatBlocks(fields, profile);
  assert.deepEqual(fields.map((f) => core.repeatFieldValue(f, repeats.get(f.id), profile)), ["Python", "熟练", "Tableau", "熟悉"]);
  // Cards already saved above the empty form are not added again.
  const saved = core.classifyRepeatBlocks(fields.slice(0, 2), profile, "专业技能 Python 熟练 编辑 删除");
  assert.equal(core.repeatFieldValue(fields[0], saved.repeats.get("a"), profile), "Tableau");
});

test("labels that looked like a row's name or date no longer are", () => {
  assert.equal(core.resolveRepeatField(field("是否211院校", "教育经历", { tag: "radio", options: ["是", "否"] }), new Map()), null);
  assert.equal(core.resolveRepeatField(field("公司所属行业", "实习经历"), new Map()), null);
  assert.equal(core.resolveRepeatField(field("工作单位所在城市"), new Map()), null);
  assert.equal(kind(core.resolveRepeatField(field("所在部门", "实习经历"), new Map())), "experience:department");
  assert.equal(kind(core.resolveRepeatField(field("项目简述*", "项目经历", { tag: "textarea" }), new Map())), "project:description");
  assert.equal(kind(core.resolveRepeatField(field("个人工作", "项目经历", { tag: "textarea" }), new Map())), "project:responsibilities");
  const award = core.resolveRepeatField(field("受到奖励", "教育经历", { tag: "textarea" }), new Map());
  assert.equal(kind(award), "award:summary"); assert.equal(award.foreign, true);
  const campus = core.resolveRepeatField(field("校内活动", "教育经历", { tag: "textarea" }), new Map());
  assert.equal(kind(campus), "campus:summary"); assert.equal(campus.foreign, true);
});

test("new 常问字段 fill their labels", () => {
  const profile = { qq: "123456789", homepage: "https://github.com/x", hobbies: "摄影", thesis: "论文题目", lab: "控制实验室" };
  const expected = { "QQ号*": "123456789", 作品链接: "https://github.com/x", 兴趣爱好: "摄影", 毕业论文题目: "论文题目", 所在实验室: "控制实验室", LinkedIn: null };
  for (const [label, value] of Object.entries(expected)) assert.equal(core.matchFlatField(field(label), profile), value, label);
});
