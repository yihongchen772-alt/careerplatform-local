const test = require("node:test");
const assert = require("node:assert/strict");

// Matching rules behind the multi-portal fill lab (AntD / Element / table
// layouts / English ATS forms / custom widgets): pure functions, no browser.
const core = require("../electron/autofill-core.js");

const profile = {
  name: "林晓舟", phone: "+86 138-1234-5678", email: "linxz@example.invalid", gender: "女", birthDate: "2002-03-15",
  english: "CET-6 560", currentCity: "上海", preferredCities: "上海", hometown: "江苏南京", politics: "共青团员",
  education: [
    { school: "复旦大学", major: "统计学", degree: "硕士", start: "2024-09", end: "2026-06" },
    { school: "南京大学", major: "数学与应用数学", degree: "本科", start: "2020-09", end: "2024-06" },
  ],
};
const field = (label, extra = {}) => ({ id: extra.id || `f-${label}`, label, placeholder: "", name: "", tag: "input", type: "text", section: "", ...extra });

test("someone else's details never receive the applicant's own facts", () => {
  for (const [label, section] of [["紧急联系人姓名", ""], ["联系人电话", "紧急联系人"], ["姓名", "家庭成员"], ["工作单位", "家庭成员"], ["父母姓名", "个人及家庭信息"], ["Emergency Contact Phone", ""], ["Parent's Name", ""]]) {
    const f = field(label, { section });
    assert.equal(core.isThirdPartyField(f), true, `${section} ${label}`);
    assert.equal(core.matchFlatField(f, profile), null, `${section} ${label}`);
    assert.equal(core.resolveRepeatField(f, new Map()), null, `${section} ${label}`);
    assert.equal(core.isForbiddenMemoryField(f), true, `${section} ${label}`);
    assert.equal(core.fieldModule(f), "other", `${section} ${label}`);
  }
  // A heading that also covers the applicant keeps their own fields.
  assert.equal(core.isThirdPartyField(field("现居城市", { section: "个人及家庭信息" })), false);
  assert.equal(core.matchFlatField(field("现居城市", { section: "个人及家庭信息" }), profile), "上海");
  assert.equal(core.isThirdPartyField(field("家庭住址")), false);
  assert.equal(core.isThirdPartyField(field("联系方式")), false);
});

test("look-alike labels are not filled with the wrong fact", () => {
  const cases = [
    ["姓名拼音", null], ["English Name (if any)", null], ["Preferred Name", null], ["Username", null],
    ["Mailing Address", null], ["Place of Birth", null], ["出生地", null], ["固定电话", null], ["Home Phone", null],
    ["Phone Device Type", null],
  ];
  for (const [label, expected] of cases) assert.equal(core.matchFlatField(field(label), profile), expected, label);
  // "tel" is a whole word: an English essay prompt is not a phone box.
  assert.notEqual(core.matchFlatField(field("Tell us why you are interested in this role."), profile), "13812345678");
  assert.equal(core.matchFlatField(field("Tel"), profile), "13812345678");
  assert.equal(core.matchFlatField(field("", { name: "mobilePhone" }), profile), "13812345678");
  assert.equal(core.matchFlatField(field("电子邮件"), profile), "linxz@example.invalid");
  assert.equal(core.matchFlatField(field("Email Address"), profile), "linxz@example.invalid");
  assert.equal(core.matchFlatField(field("City"), profile), "上海");
  assert.equal(core.matchFlatField(field("意向工作地点"), profile), "上海");
  assert.equal(core.matchFlatField(field("Political Status", { options: ["中共党员", "共青团员", "群众"] }), profile), "共青团员");
});

test("phone numbers fit the box and phone choices follow a mainland number", () => {
  assert.equal(core.normalizePhone(field("手机号", { maxLength: 11 }), "+86 138-1234-5678"), "13812345678");
  assert.equal(core.normalizePhone(field("Phone"), "(65) 9123 4567"), "(65) 9123 4567");
  assert.equal(core.matchFlatField(field("Country Phone Code", { tag: "select", options: ["Hong Kong (+852)", "China (+86)", "Singapore (+65)"] }), profile), "China (+86)");
  assert.equal(core.matchFlatField(field("国家/地区代码", { tag: "select", options: ["中国香港 +852", "中国大陆 +86"] }), profile), "中国大陆 +86");
  assert.equal(core.matchFlatField(field("Phone Device Type", { tag: "select", options: ["Home", "Mobile", "Work"] }), profile), "Mobile");
  assert.equal(core.matchFlatField(field("Country Phone Code", { tag: "select", options: ["China (+86)"] }), { ...profile, phone: "+65 9123 4567" }), null);
});

test("an English level is matched against what the field actually asks", () => {
  const levels = ["未通过", "大学英语四级", "大学英语六级", "专业英语四级", "专业英语八级"];
  assert.equal(core.matchFlatField(field("外语水平", { tag: "select", options: levels }), profile), "大学英语六级");
  assert.equal(core.matchFlatField(field("英语等级", { tag: "select", options: levels }), { ...profile, english: "专业四级" }), "专业英语四级");
  assert.equal(core.matchFlatField(field("英语等级", { tag: "select", options: levels }), { ...profile, english: "CET-4 520" }), "大学英语四级");
  assert.equal(core.matchFlatField(field("外语成绩"), profile), "560");
  assert.equal(core.matchFlatField(field("外语语种", { tag: "select", options: ["英语", "日语", "德语"] }), profile), "英语");
  assert.equal(core.matchFlatField(field("英语水平"), profile), "CET-6 560");
});

test("split 年 / 月 dropdowns take their own part of a date and stay on one row", () => {
  const years = ["1999", "2000", "2001", "2002", "2003"];
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1));
  assert.equal(core.matchFlatField(field("出生年月", { tag: "select", options: years, datePart: "year" }), profile), "2002");
  assert.equal(core.matchFlatField(field("出生年月", { tag: "select", options: months, datePart: "month" }), profile), "3");
  const rows = new Map();
  const year = core.matchBasicField(field("毕业年月", { tag: "select", options: ["2024", "2025", "2026"], datePart: "year" }), profile, rows);
  const month = core.matchBasicField(field("毕业年月", { tag: "select", options: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"], datePart: "month" }), profile, rows);
  assert.deepEqual([year, month], ["2026", "06"]);
});

test("dates follow month-first examples, page hints and picker types", () => {
  assert.equal(core.formatDateForField(field("From", { placeholder: "MM/YYYY" }), "2024-09"), "09/2024");
  assert.equal(core.formatDateForField(field("To", { placeholder: "09/2024" }), "2026-06"), "06/2026");
  assert.equal(core.formatDateForField(field("Start", { placeholder: "DD/MM/YYYY" }), "2024-09"), "01/09/2024");
  assert.equal(core.formatDateForField(field("Start", { placeholder: "MM/DD/YYYY" }), "2024-09-15"), "09/15/2024");
  assert.equal(core.formatDateForField(field("毕业时间", { hint: "格式：2026-07-01" }), "2026-06"), "2026-06-01");
  assert.equal(core.formatDateForField(field("入学时间", { placeholder: "选择月", pickerType: "month" }), "2024-09"), "2024-09");
  assert.equal(core.formatDateForField(field("到岗日期", { pickerType: "date" }), "2026-07"), "2026-07-01");
  // A birthday is never padded to the 1st.
  assert.equal(core.matchFlatField(field("出生日期", { type: "date" }), { ...profile, birthDate: "2002-03" }), null);
  assert.equal(core.matchFlatField(field("出生年月"), { ...profile, birthDate: "2002-03" }), "2002-03");
});

test("one education block split across two table rows keeps one record", () => {
  // 毕业院校 / 所学专业 sit in a detected block; 学历 / 毕业时间 on the next
  // table row are loose. Both are the highest degree, not 本科.
  const fields = [
    field("毕业院校", { id: "a", section: "最高学历教育情况", blockKey: "education:row1" }),
    field("所学专业", { id: "b", section: "最高学历教育情况", blockKey: "education:row1" }),
    field("学历", { id: "c", section: "最高学历教育情况", tag: "select", options: ["大学本科", "硕士研究生", "博士研究生"] }),
    field("毕业时间", { id: "d", section: "最高学历教育情况" }),
  ];
  const { repeats } = core.classifyRepeatBlocks(fields, profile);
  const values = fields.map((f) => core.repeatFieldValue(f, repeats.get(f.id), profile));
  assert.deepEqual(values, ["复旦大学", "统计学", "硕士研究生", "2026-06"]);
});

test("new profile extras fill their common labels", () => {
  const extras = { ...profile, wechat: "linxz_wx", expectedSalary: "面议", availableFrom: "2026-07", internshipDuration: "6 个月", address: "上海市杨浦区邯郸路 220 号" };
  assert.equal(core.matchFlatField(field("微信号"), extras), "linxz_wx");
  assert.equal(core.matchFlatField(field("期望薪资"), extras), "面议");
  assert.equal(core.matchFlatField(field("最早到岗时间", { pickerType: "date" }), extras), "2026-07-01");
  assert.equal(core.matchFlatField(field("可实习时长"), extras), "6 个月");
  assert.equal(core.matchFlatField(field("通讯地址"), extras), "上海市杨浦区邯郸路 220 号");
  assert.equal(core.matchFlatField(field("现住址"), extras), "上海市杨浦区邯郸路 220 号");
});

test("results label decorated fields plainly and explain what to do", () => {
  assert.equal(core.displayLabel(field("*姓名：")), "姓名");
  const thirdParty = core.fillDetail(field("紧急联系人姓名"), null, new Set(), new Set());
  assert.equal(thirdParty.source, "manual");
  assert.match(thirdParty.state, /他人信息/);
  const picker = core.fillDetail(field("出生日期", { readonlyPicker: true, suggestion: "2002-03-15" }), null, new Set(), new Set());
  assert.match(picker.state, /网页上点选：2002-03-15/);
});

test("a page draft's captured blank boxes never blank out the preview's suggestions", async () => {
  const url = "https://fixture.example/apply";
  const fields = [
    { id: "f0", mappingKey: "school-0", label: "学校", section: "教育经历", tag: "input", hasValue: false },
    { id: "f1", mappingKey: "essay", label: "为什么申请本岗位？", tag: "textarea", hasValue: false },
  ];
  // What the 2.5-second auto-save stores for a page the applicant only looked at,
  // plus one answer they had typed before reloading.
  const draft = { content: { url, resumeVersionId: "resume", variantId: "", fields: [
    { label: "学校", fieldKey: "school-0", value: "", selected: false, captured: true, edited: false },
    { label: "为什么申请本岗位？", fieldKey: "essay", value: "我自己写的回答", selected: false, captured: true, edited: true },
  ] } };
  let plan;
  const adapter = {
    taskId: "fixture", url: () => url, stillOnPage: () => true, frames: async () => [0], getPlan: () => plan, setPlan: (value) => { plan = value; }, getDrafts: () => [], setDrafts() {}, status() {}, uploadResume: async () => 0,
    api: async (name) => ({ ok: true, json: async () => name.startsWith("profile") ? { education: [{ school: "大学甲" }] } : name.startsWith("application-draft") ? draft : name === "answer-questions" ? { answers: [] } : null }),
    run: async (_frame, fn) => (fn === core.scanPageFields ? structuredClone(fields) : fn === core.validatePageFields ? [] : undefined),
  };
  const preview = await core.runAutofillCore(adapter, "resume", { mode: "preview" });
  const school = preview.plan.proposals.find((p) => p.id === "f0");
  assert.equal(school.value, "大学甲");
  assert.equal(school.selected, true);
  const essay = preview.plan.proposals.find((p) => p.id === "f1");
  assert.equal(essay.value, "我自己写的回答");
  assert.equal(essay.selected, false);
});
