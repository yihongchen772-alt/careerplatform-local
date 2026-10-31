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
const basic = (f, profile) => core.matchBasicField(f, profile, new Map());
const kind = (info) => (info ? `${info.group}:${info.kind}` : null);

test("a box that says YYYY takes the year alone (飞书 获奖时间 turned 2023-11 down 18 times)", () => {
  assert.equal(core.formatDateForField(field("获奖时间", { placeholder: "YYYY" }), "2023-11"), "2023");
  assert.equal(core.formatDateForField(field("获奖时间", { placeholder: "yyyy年" }), "2023.11"), "2023");
  // Formats that name a month keep it.
  assert.equal(core.formatDateForField(field("出生日期", { placeholder: "YYYY-MM" }), "2002-03-15"), "2002-03");
  assert.equal(core.formatDateForField(field("Start date", { placeholder: "MM/YYYY" }), "2024-09"), "09/2024");
  assert.equal(core.formatDateForField(field("入学时间", { placeholder: "YYYYMM" }), "2024-09"), "2024-09");
});

test("是否 questions answer 是 / 否 whatever the saved wording (蔚来's 是否接受调剂)", () => {
  assert.equal(basic(field("是否接受调剂*"), { acceptAdjust: "接受" }), "是");
  assert.equal(basic(field("是否服从调剂"), { acceptAdjust: "不接受" }), "否");
  // Not a 是否 question: the saved words stay.
  assert.equal(basic(field("接受调剂*"), { acceptAdjust: "接受" }), "接受");
  // A dropdown in its own words.
  assert.equal(basic(field("是否接受调剂", { tag: "select", options: ["接受", "不接受"] }), { acceptAdjust: "是" }), "接受");
  assert.equal(basic(field("是否服从分配", { tag: "radio", options: ["是", "否"] }), { acceptAdjust: "服从" }), "是");
  // 有交换经历？ a saved description means 是, 「无」 means 否.
  assert.equal(basic(field("是否有海外交换经历", { tag: "select", options: ["是", "否"] }), { exchange: "2023 春 新加坡国立大学交换一学期" }), "是");
  assert.equal(basic(field("是否有海外交换经历", { tag: "select", options: ["是", "否"] }), { exchange: "无" }), "否");
  assert.equal(core.yesNoAnswer(field("是否接受调剂"), "看情况"), undefined, "an answer that is neither stays as typed");
});

test("still studying full time: 全日制在校、应届、学习形式 come from the education rows", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  const studying = { education: [{ school: "复旦大学", degree: "硕士", start: "2024-09", end: "2027-06" }, { school: "南京大学", degree: "本科", start: "2020-09", end: "2024-06" }] };
  const done = { education: [{ school: "南京大学", degree: "本科", start: "2020-09", end: "2024-06" }] };
  assert.equal(core.studyingNow(studying, now), true);
  assert.equal(core.studyingNow(done, now), false);
  assert.equal(core.studyingNow({ education: [{ school: "复旦大学", degree: "硕士", start: "2024-09", end: "至今" }] }, now), true);
  assert.equal(core.studyMode(studying), "全日制");
  assert.equal(core.studyMode({ education: [{ school: "某大学", degree: "非全日制硕士", end: "2027-06" }] }), "非全日制");
  // 全日制 between 全日制 / 非全日制 picks the plain one.
  assert.equal(core.matchFieldOption({ options: ["非全日制", "统招全日制", "自考"] }, "全日制"), "统招全日制");
  assert.equal(basic(field("学习形式", { tag: "select", options: ["全日制", "非全日制"] }), studying), "全日制");
});

test("国籍 is 中国 when 民族 / 政治面貌 / 籍贯 are Chinese, whatever the country of residence", () => {
  const profile = { ethnicity: "汉族", currentCity: "新加坡" };
  assert.equal(basic(field("国籍"), profile), "中国");
  assert.equal(basic(field("国籍（地区）", { tag: "select", options: ["中国香港", "中国大陆", "美国"] }), profile), "中国大陆");
  assert.equal(basic(field("国籍"), { currentCity: "上海" }), null, "nothing says so: left alone");
  assert.equal(basic(field("父亲国籍"), profile), null);
});

test("研究方向: one-line boxes take the short version, description boxes the paragraph", () => {
  const paragraph = "多传感器融合导航：基于信息滤波融合 IMU、GNSS 与视觉，研究复杂环境下的定位精度与鲁棒性。";
  assert.equal(basic(field("研究方向"), { researchDirection: paragraph }), "多传感器融合导航");
  assert.equal(basic(field("研究方向"), { researchDirection: paragraph, researchTopic: "组合导航" }), "组合导航");
  assert.equal(basic(field("专业描述（所修专业的具体研究方向）", { tag: "textarea" }), { researchDirection: paragraph }), paragraph);
  assert.equal(core.learnableProfileKey(field("研究方向")), "researchTopic");
  assert.equal(core.learnableProfileKey(field("研究方向", { tag: "textarea" })), "researchDirection");
  // No short phrase to take: nothing, rather than the paragraph in a one-line box.
  assert.equal(basic(field("研究方向"), { researchDirection: "x".repeat(60) }), null);
  const learning = load("src/lib/profile-learning.ts");
  assert.equal(learning.shortVersionKey("researchDirection", "组合导航", { researchDirection: paragraph }), "researchTopic");
  assert.equal(learning.shortVersionKey("researchDirection", "组合导航", { researchDirection: "" }), "researchDirection", "a blank paragraph is learned as usual");
});

test("text over a box's limit is cut back to whole sentences that fit", () => {
  const intro = "统计学硕士在读。在字节跳动做过增长分析实习。熟悉 SQL 和 Python。担任研究生会学术部部长。";
  assert.equal(core.fitToLimit(intro, 30), "统计学硕士在读。在字节跳动做过增长分析实习。");
  assert.equal(core.fitToLimit(intro, 200), intro);
  assert.equal(core.fitToLimit("多传感器融合导航，信息滤波，鲁棒定位与建图研究方向说明", 12), "多传感器融合导航");
  assert.equal(core.fitToLimit("x".repeat(50), 20), null);
  assert.equal(core.textLimitFor(field("自我介绍", { maxLength: 300 })), 300);
  assert.equal(core.textLimitFor(field("自我介绍（限200字）")), 200);
  assert.equal(core.textLimitFor(field("项目描述", { placeholder: "500字以内" })), 500);
  assert.equal(core.textLimitFor(field("工作职责", { hint: "0/2000" })), 2000);
  assert.equal(core.textLimitFor(field("意向城市", { placeholder: "最多3个,空格隔开" })), null);
});

test("自我介绍 boxes take the saved 自我评价; an English one does not", () => {
  assert.equal(basic(field("自我介绍（选填）", { tag: "textarea" }), { selfIntro: "认真负责。" }), "认真负责。");
  assert.equal(basic(field("英文自我介绍", { tag: "textarea" }), { selfIntro: "认真负责。" }), null);
});

test("学生干部情况 and 奖学金情况 are the campus list and the scholarships, in one box", () => {
  assert.equal(kind(core.resolveRepeatField(field("就读期间担任学生干部情况*"), new Map())), "campus:summary");
  assert.equal(kind(core.resolveRepeatField(field("是否担任学生干部"), new Map())), null);
  const scholarship = core.resolveRepeatField(field("奖学金情况"), new Map());
  assert.equal(kind(scholarship), "award:summary");
  const profile = { awards: [{ name: "数学建模一等奖", level: "国家级" }, { name: "国家奖学金", level: "国家级", date: "2023-10" }] };
  const value = core.repeatFieldValue(field("奖学金情况"), { ...scholarship, all: true }, profile);
  assert.match(value, /国家奖学金/);
  assert.doesNotMatch(value, /数学建模/);
});

test("empty modules with only 「添加」: 社交账号 and 自我评价 are offered when the profile has something for them", () => {
  const profile = { wechat: "zoe_wx", qq: "123", selfIntro: "认真负责。", awards: [{ name: "奖" }] };
  const rows = new Map();
  const groups = (fields) => core.emptyModules(profile, rows, fields).map((item) => `${item.group}:${item.saved}-${item.shown}`);
  assert.deepEqual(groups([]), ["award:1-0", "social:2-0", "selfIntro:1-0"]);
  assert.deepEqual(groups([field("社交平台"), field("社交平台"), field("自我评价", { tag: "textarea" })]), ["award:1-0"]);
});

test("a block the site filled itself with one fact wrong still takes its row; the odd fact is reported", () => {
  const profile = { education: [{ school: "复旦大学", major: "统计学", degree: "硕士", start: "2024-09", end: "2026-06" }, { school: "南京大学", major: "数学", degree: "本科", start: "2020-09", end: "2024-06" }] };
  const section = "教育经历";
  const fields = [
    { ...field("学校名称", { section }), hasValue: true, currentValue: "南京大学" },
    { ...field("学历", { section, tag: "select", options: ["本科", "硕士"] }), hasValue: true, currentValue: "硕士" },
    { ...field("专业", { section }) },
    { ...field("开始时间", { section }), hasValue: true, currentValue: "2020.09" },
    { ...field("结束时间", { section }), hasValue: true, currentValue: "2024.06" },
  ].map((item, index) => ({ ...item, id: `e${index}`, blockKey: "education:b1" }));
  const { blocks, repeats } = core.classifyRepeatBlocks(fields, profile);
  const block = [...blocks.values()][0];
  assert.equal(block.unmatched, false);
  assert.equal(block.row, 1);
  assert.match(block.conflict, /学历.*硕士.*本科/);
  assert.equal(core.repeatFieldValue(fields[2], repeats.get("e2"), profile), "数学");
  // 学士 on the page for 本科 saved is the same degree: no conflict.
  const same = fields.map((item) => (item.id === "e1" ? { ...item, options: ["学士", "硕士"], currentValue: "学士" } : item));
  const again = [...core.classifyRepeatBlocks(same, profile).blocks.values()][0];
  assert.equal(again.row, 1);
  assert.equal(again.conflict, undefined);
});

test("the new rules stay out of look-alike labels", () => {
  const profile = { selfIntro: "认真负责。", education: [{ school: "复旦大学", degree: "本科", end: "2099-06" }] };
  assert.equal(basic(field("请做一个自我介绍，并说明你为什么适合这个岗位", { tag: "textarea" }), profile), null);
  assert.equal(basic(field("应届生求职登录"), profile), null);
  assert.equal(basic(field("是否在读研究生", { tag: "select", options: ["是", "否"] }), profile), null);
  assert.equal(basic(field("是否为应届毕业生", { tag: "select", options: ["是", "否"] }), profile), "是");
  assert.equal(basic(field("是否为全日制在校学生", { tag: "select", options: ["是", "否"] }), profile), "是");
});

test("prose cut at a comma still ends as a sentence; a short phrase does not get a full stop", () => {
  const long = "我在新加坡国立大学读硕士，研究多传感器融合导航，熟悉 C++ 和 Python，做过两段机器人公司的算法实习，也带过课程项目的团队";
  const cut = core.fitToLimit(long, 40);
  assert.ok(cut.length <= 40 && cut.endsWith("。"), cut);
  assert.equal(core.fitToLimit("多传感器融合导航，信息滤波，鲁棒定位与建图研究方向说明", 12), "多传感器融合导航");
});

test("a 是否 text box keeps a saved description; a limit counts from a hint only when the hint is the limit", () => {
  assert.equal(basic(field("是否有海外交换经历（如有请说明）"), { exchange: "2023 春 新加坡国立大学交换一学期" }), "2023 春 新加坡国立大学交换一学期");
  assert.equal(basic(field("是否有海外交换经历"), { exchange: "无" }), "否");
  assert.equal(core.textLimitFor(field("项目名称", { hint: "项目描述（限20字）" })), null, "the next row's caption");
  assert.equal(core.textLimitFor(field("项目描述", { hint: "（限300字）" })), 300);
  assert.equal(core.textLimitFor(field("工作职责", { hint: "0/2000" })), 2000);
});

test("a module with any of its boxes on the page is not empty; a 自我介绍 box counts as the 自我评价", () => {
  const profile = { education: [{ school: "复旦大学" }], selfIntro: "认真负责。" };
  // 海康: 学校 is a pop-up picker, but the 时间 / 学历 boxes of the open form are there.
  const rows = new Map([["education:start:in", 1], ["education:degree:in", 1]]);
  assert.deepEqual(core.emptyModules(profile, rows, [field("自我介绍（选填）", { tag: "textarea" })]).map((item) => item.group), []);
  assert.deepEqual(core.emptyModules(profile, new Map(), []).map((item) => item.group), ["education", "selfIntro"]);
});

test("v1.35: numbered questions, the job applied for, 其他岗位机会, 工作年限, 成绩", () => {
  const profile = { appliedJob: "高级算法工程师", acceptAdjust: "接受", education: [{ school: "东南大学", gpa: "3.8/4.0", end: "2099-06" }] };
  assert.equal(basic(field("*01投递岗位"), profile), "高级算法工程师");
  assert.equal(basic(field("期望岗位"), profile), null, "the wished-for job is not the applied one");
  assert.equal(basic(field("是否接受其他岗位机会?"), profile), "是");
  assert.equal(basic(field("工作年限", { tag: "select", options: ["1年以下", "应届生", "1-3年"] }), profile), "应届生");
  assert.equal(basic(field("工作年限"), profile), "应届生");
  assert.equal(kind(core.resolveRepeatField(field("成绩", { section: "教育经历" }), new Map())), "education:gpa");
  // 「12项目经历」 is the 项目经历 box.
  assert.equal(kind(core.resolveRepeatField(field("12项目经历", { tag: "textarea" }), new Map())), kind(core.resolveRepeatField(field("项目经历", { tag: "textarea" }), new Map())));
  assert.notEqual(kind(core.resolveRepeatField(field("12项目经历", { tag: "textarea" }), new Map())), null);
});
