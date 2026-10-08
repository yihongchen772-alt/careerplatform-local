const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// The browser helpers live in Electron's main-process module. Evaluate its
// pure functions with Electron stubbed, without opening a window or website.
const source = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
// autofill-core.js is evaluated inside the same sandbox (wrapped, so its
// declarations don't collide with browser-view's destructuring), letting a
// test swap in a fake `document` that the injected helpers then see.
const context = vm.createContext({ module: { exports: {} }, URL, URLSearchParams });
const coreModule = { exports: {} };
vm.runInContext(`(function (module, exports) {\n${fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8")}\n})`, context)(coreModule, coreModule.exports);
context.require = (name) => name === "electron" ? {} : name === "./autofill-core.js" ? coreModule.exports : require(name);
vm.runInContext(`${source}\nmodule.exports.__test = { fillDetail, formatDateForField, dateRangeValue, degreeAlternatives, matchBasicField, resolveRepeatField, repeatFieldValue, missingRepeatBlocks, repeatFieldGoesToAi, matchRememberedField, fieldMemoryKey, isForbiddenMemoryField, isNeverGuessField, isOpenEndedQuestionField, isSensitiveMemoryField, portalContext, memoryCandidate, trackUserEdits, assertTrustedBrowserEvent, safeDownloadFilename, openSafeExternalUrl };`, context);
const { fillDetail, formatDateForField, dateRangeValue, degreeAlternatives, matchBasicField, resolveRepeatField, repeatFieldValue, missingRepeatBlocks, repeatFieldGoesToAi, matchRememberedField, fieldMemoryKey, isForbiddenMemoryField, isNeverGuessField, isOpenEndedQuestionField, isSensitiveMemoryField, portalContext, memoryCandidate, trackUserEdits, assertTrustedBrowserEvent, safeDownloadFilename, openSafeExternalUrl } = context.module.exports.__test;

const profile = { name: "陈奕宏", email: "me@example.invalid" };

test("full name is filled, but split names are never guessed", () => {
  assert.equal(matchBasicField({ label: "Full Name", placeholder: "", name: "" }, profile), "陈奕宏");
  for (const label of ["First Name", "Last Name", "given_name", "Family Name", "姓", "名", "姓氏", "名字"]) {
    const field = { label, placeholder: "", name: "", tag: "input", type: "text" };
    assert.equal(matchBasicField(field, profile), null, label);
    assert.equal(isNeverGuessField(field), true, label);
  }
});

test("open-ended text inputs join textareas in answer memory", () => {
  assert.equal(isOpenEndedQuestionField({ tag: "textarea", label: "自我介绍", placeholder: "", name: "" }), true);
  assert.equal(isOpenEndedQuestionField({ tag: "input", type: "text", label: "为什么申请这个岗位？", placeholder: "", name: "" }), true);
  assert.equal(isOpenEndedQuestionField({ tag: "input", type: "text", label: "邮箱", placeholder: "", name: "" }), false);
  assert.equal(isOpenEndedQuestionField({ tag: "input", type: "number", label: "相关经历年数", placeholder: "", name: "" }), false);
  assert.equal(isSensitiveMemoryField({ tag: "textarea", label: "家庭住址", placeholder: "", name: "" }), true);
  assert.equal(isSensitiveMemoryField({ tag: "textarea", label: "自我介绍", placeholder: "", name: "" }), false);
});

test("company context conservatively isolates unknown sites and shares explicit portal tenants", () => {
  assert.notEqual(portalContext("https://careers.example.com/apply/123"), portalContext("https://careers.example.com/candidate/456"));
  assert.notEqual(portalContext("https://app.mokahr.com/apply/acme"), portalContext("https://app.mokahr.com/apply/other"));
  assert.equal(portalContext("https://app.mokahr.com/apply/a?tenant=acme"), portalContext("https://app.mokahr.com/candidate/b?tenant=acme"));
});

test("saved projects fill matching portal fields in order without using the applicant's name", () => {
  const projects = [
    { name: "招聘数据看板", role: "负责人", start: "2025-01", end: "2025-03", description: "搭建可视化看板", responsibilities: "负责数据建模" },
    { name: "课程推荐系统", role: "开发成员", start: "2024-06", end: "2024-08", description: "实现推荐算法", responsibilities: "负责模型评估" },
  ];
  const savedProfile = { ...profile, projects };
  const indexes = new Map();
  const field = (label) => ({ label, placeholder: "", name: "", tag: "input", type: "text" });
  assert.equal(matchBasicField(field("Project Name"), savedProfile, indexes), "招聘数据看板");
  assert.equal(matchBasicField(field("项目名称"), savedProfile, indexes), "课程推荐系统");
  assert.equal(matchBasicField(field("项目职责"), savedProfile, indexes), "负责模型评估");
  assert.equal(matchBasicField(field("项目经历"), savedProfile, indexes), "招聘数据看板；负责人；搭建可视化看板；负责数据建模");
  assert.equal(matchBasicField(field("项目名称"), savedProfile, new Map([["project:name:out", 1]])), "课程推荐系统");
  assert.equal(matchBasicField(field("Project Name"), profile, new Map()), null);
});

test("two education blocks get 硕士 then 本科, not the first row twice", () => {
  const education = [
    { school: "新加坡国立大学", major: "商业分析", degree: "硕士", gpa: "4.2/5", start: "2025-08", end: "2026-12" },
    { school: "华东师范大学", major: "统计学", degree: "本科", gpa: "3.7/4", start: "2021-09", end: "2025-06" },
  ];
  const savedProfile = { ...profile, school: "新加坡国立大学", education };
  const field = (label, section = "教育经历", extra = {}) => ({ label, placeholder: "", name: "", tag: "input", type: "text", section, ...extra });
  const rows = new Map();
  const values = ["学校", "专业", "学历", "GPA", "入学时间", "毕业时间", "学校", "专业", "学历", "GPA", "入学时间", "毕业时间"]
    .map((label) => matchBasicField(field(label), savedProfile, rows));
  assert.deepEqual(values, ["新加坡国立大学", "商业分析", "硕士", "4.2/5", "2025-08", "2026-12", "华东师范大学", "统计学", "本科", "3.7/4", "2021-09", "2025-06"]);
  // Saved 本科 first: the form still gets the highest degree first.
  const reversed = { ...profile, education: [...education].reverse() };
  const order = new Map();
  assert.equal(matchBasicField(field("毕业院校"), reversed, order), "新加坡国立大学");
  assert.equal(matchBasicField(field("毕业院校"), reversed, order), "华东师范大学");
  assert.deepEqual([...missingRepeatBlocks(savedProfile, new Map([["education:school:in", 1]]))], ["有 2 段教育经历、页面只有 1 组"]);
  assert.equal(missingRepeatBlocks(savedProfile, rows).length, 0);
});

test("degree words in labels or block headings pick the matching education row", () => {
  const savedProfile = { ...profile, education: [
    { school: "新加坡国立大学", major: "商业分析", degree: "研究生", start: "2025-08", end: "2026-12" },
    { school: "华东师范大学", major: "统计学", degree: "本科", start: "2021-09", end: "2025-06" },
  ] };
  const field = (label, section = "", options) => ({ label, placeholder: "", name: "", tag: options ? "select" : "input", type: "", section, options });
  const rows = new Map();
  assert.equal(matchBasicField(field("本科院校"), savedProfile, rows), "华东师范大学");
  assert.equal(matchBasicField(field("本科专业"), savedProfile, rows), "统计学");
  assert.equal(matchBasicField(field("硕士院校"), savedProfile, rows), "新加坡国立大学");
  assert.equal(matchBasicField(field("博士院校"), savedProfile, rows), null);
  assert.equal(matchBasicField(field("开始时间", "本科阶段"), savedProfile, new Map()), "2021-09");
  assert.equal(matchBasicField(field("学历", "本科阶段", ["学士", "硕士", "博士"]), savedProfile, new Map()), "学士");
  assert.equal(matchBasicField(field("学历", "教育经历", ["大专", "本科", "硕士研究生", "博士研究生"]), savedProfile, new Map()), "硕士研究生");
  assert.equal(matchBasicField(field("最高学历", "", ["本科", "硕士", "博士"]), savedProfile, new Map()), "硕士");
  assert.equal(matchBasicField(field("学校", "教育经历 2"), savedProfile, new Map()), "华东师范大学");
  assert.equal(matchBasicField(field("学校", "第二段教育经历"), savedProfile, new Map()), "华东师范大学");
});

test("dates follow each field's precision; a full date defaults to the 1st", () => {
  const field = (label, placeholder = "", type = "text") => ({ label, placeholder, name: "", tag: "input", type });
  assert.equal(formatDateForField(field("开始时间", "请选择日期"), "2025-08"), "2025-08-01");
  assert.equal(formatDateForField(field("开始时间", "Select date"), "2025.8"), "2025-08-01");
  assert.equal(formatDateForField(field("开始时间", "", "date"), "2025-08"), "2025-08-01");
  assert.equal(formatDateForField(field("开始时间", "YYYY/MM/DD"), "2025-08"), "2025/08/01");
  assert.equal(formatDateForField(field("开始时间", "2020年09月01日"), "2025-08"), "2025年08月01日");
  assert.equal(formatDateForField(field("开始时间", "请选择月份"), "2025-08-15"), "2025-08");
  assert.equal(formatDateForField(field("开始时间", "如 2020.09"), "2025-08"), "2025.08");
  assert.equal(formatDateForField(field("开始时间", "", "month"), "2025/8"), "2025-08");
  assert.equal(formatDateForField(field("开始时间"), "2025年8月"), "2025-08");
  assert.equal(formatDateForField(field("毕业年份"), "2026-12"), "2026");
  assert.equal(formatDateForField(field("毕业时间", "", "date"), "2026"), "");
  assert.equal(formatDateForField(field("结束时间", "请选择日期"), "至今"), "至今");
  assert.equal(formatDateForField(field("结束时间"), "Present"), "至今");
});

test("one-box date spans follow the page's own example", () => {
  const field = (placeholder, type = "text") => ({ label: "起止时间", placeholder, name: "", tag: "input", type });
  assert.equal(dateRangeValue(field("如 2020.09-2024.06"), "2021-09", "2025-06"), "2021.09 - 2025.06");
  assert.equal(dateRangeValue(field("2020-09-01 ~ 2024-06-30"), "2021-09", "2025-06"), "2021-09-01 ~ 2025-06-01");
  assert.equal(dateRangeValue(field(""), "2021-09", "2025-06"), "2021-09 至 2025-06");
  assert.equal(dateRangeValue(field("如 2020.09-至今"), "2025-06", "至今"), "2025.06 - 至今");
  assert.equal(dateRangeValue(field(""), "2021-09", ""), "");
  assert.equal(dateRangeValue(field("", "date"), "2021-09", "2025-06"), "");
  const savedProfile = { ...profile, experiences: [{ company: "美团", start: "2026-01", end: "至今" }], education: [{ school: "东南大学", degree: "本科", start: "2021-09", end: "2025-06" }] };
  const inBlock = (label, section, placeholder = "") => ({ label, placeholder, name: "", tag: "input", type: "text", section });
  assert.equal(matchBasicField(inBlock("起止时间", "实习经历", "如 2020.09-2024.06"), savedProfile, new Map()), "2026.01 - 至今");
  assert.equal(matchBasicField(inBlock("在校时间", ""), savedProfile, new Map()), "2021-09 至 2025-06");
  assert.equal(matchBasicField(inBlock("时间", "教育经历"), savedProfile, new Map()), "2021-09 至 2025-06");
  assert.equal(resolveRepeatField(inBlock("每周实习时间", "实习经历"), new Map()), null);
  assert.equal(resolveRepeatField(inBlock("离职原因", "实习经历"), new Map()), null);
  assert.equal(resolveRepeatField(inBlock("入职时间", "实习经历"), new Map()).kind, "start");
  assert.equal(resolveRepeatField(inBlock("离职时间", "实习经历"), new Map()).kind, "end");
  assert.equal(resolveRepeatField(inBlock("时间", ""), new Map()), null);
});

test("every field reports where its value came from", () => {
  const field = (id, label, extra = {}) => ({ id, label, placeholder: "", name: "", tag: "input", type: "text", ...extra });
  const filled = new Set(["a", "b", "c", "d"]);
  const detail = (f, pair, failed = new Set()) => fillDetail(f, pair, filled, failed);
  assert.equal(detail(field("a", "学校", { section: "教育经历 2" }), { id: "a", source: "profile" }).label, "教育经历 2 · 学校");
  assert.equal(detail(field("a", "学校"), { id: "a", source: "profile" }).source, "profile");
  assert.equal(detail(field("b", "英文名"), { id: "b", source: "remembered-field" }).source, "memory");
  assert.equal(detail(field("c", "为什么选择我们"), { id: "c", source: "remembered", remembered: true }).source, "memory");
  assert.equal(detail(field("d", "职业规划"), { id: "d", source: "ai" }).state, "AI 生成，请核对");
  assert.equal(detail(field("e", "身份证号"), undefined).source, "manual");
  assert.equal(detail(field("f", "学历", { label: "学历" }), { id: "f", label: "学历", source: "profile" }, new Set(["学历"])).state, "写入没成功，请手填");
  assert.equal(detail(field("g", "期望薪资", { hasValue: true }), undefined).source, "prefilled");
  assert.equal(detail(field("h", "紧急情况说明"), undefined).state, "没有对应资料，请手填");
});

test("custom degree dropdowns get synonyms, other dropdowns do not", () => {
  const dropdown = (label) => ({ label, placeholder: "", name: "", tag: "custom-select", type: "" });
  assert.deepEqual([...degreeAlternatives(dropdown("学历"), "学士")], ["本科", "大学本科", "本科/学士", "Bachelor"]);
  assert.ok(degreeAlternatives(dropdown("学位"), "研究生").includes("硕士研究生"));
  assert.equal(degreeAlternatives(dropdown("意向城市"), "学士"), undefined);
  assert.equal(degreeAlternatives({ ...dropdown("学历"), tag: "select" }, "学士"), undefined);
});

test("prefilled blocks, loose fields and unrelated labels keep rows aligned", () => {
  const savedProfile = { ...profile, graduationYear: 2026, education: [
    { school: "新加坡国立大学", degree: "硕士", end: "2026-12" },
    { school: "华东师范大学", degree: "本科", end: "2025-06" },
  ] };
  const field = (label, section = "") => ({ label, placeholder: "", name: "", tag: "input", type: "text", section });
  const rows = new Map();
  // 基本信息's own 毕业时间 is the highest degree and doesn't shift the blocks.
  assert.equal(matchBasicField(field("预计毕业时间", "基本信息"), savedProfile, rows), "2026-12");
  resolveRepeatField(field("学校", "教育经历"), rows); // row one already filled by the site
  assert.equal(matchBasicField(field("学校", "教育经历"), savedProfile, rows), "华东师范大学");
  // A date below the second school belongs to that school even if the
  // first block did not expose its own date field.
  assert.equal(matchBasicField(field("毕业时间", "教育经历"), savedProfile, rows), "2025-06");
  for (const label of ["专业排名", "学校所在城市", "英语成绩", "专业技能", "期望工作城市", "专业课程", "GPA排名", "离职原因", "入职部门"]) {
    assert.equal(resolveRepeatField(field(label), new Map()), null, label);
  }
  // A score box gets the score, a level box the level.
  assert.equal(matchBasicField(field("英语成绩"), { ...savedProfile, english: "CET-6 580" }, new Map()), "580");
  assert.equal(matchBasicField(field("英语水平"), { ...savedProfile, english: "CET-6 580" }, new Map()), "CET-6 580");
});

test("internship blocks fill each saved experience; unknown rows are not invented", () => {
  const savedProfile = { ...profile, experiences: [
    { company: "字节跳动", role: "数据分析实习生", start: "2025-06", end: "2025-09", description: "搭建增长看板" },
    { company: "美团", role: "产品实习生", start: "2024-07", end: "2024-09", description: "" },
  ] };
  const field = (label, tag = "input") => ({ label, placeholder: "", name: "", tag, type: "text", section: "实习经历" });
  const rows = new Map();
  const values = ["公司名称", "职位", "开始时间", "结束时间", "工作内容", "公司名称", "职位"].map((label) => matchBasicField(field(label), savedProfile, rows));
  assert.deepEqual(values, ["字节跳动", "数据分析实习生", "2025-06", "2025-09", "搭建增长看板", "美团", "产品实习生"]);
  // Outside an internship block "公司名称" is not guessed from experiences.
  assert.equal(matchBasicField({ ...field("公司名称"), section: "" }, savedProfile, new Map()), null);
  assert.equal(matchBasicField({ ...field("实习单位"), section: "" }, savedProfile, new Map()), "字节跳动");
  const thirdRow = resolveRepeatField(field("公司名称"), new Map([["experience:company:in", 2]]));
  assert.equal(repeatFieldValue(field("公司名称"), thirdRow, savedProfile), null);
  assert.equal(repeatFieldGoesToAi(thirdRow, savedProfile), false);
  const emptyDescription = resolveRepeatField(field("工作内容", "textarea"), new Map([["experience:description:in", 1]]));
  assert.equal(repeatFieldValue(field("工作内容", "textarea"), emptyDescription, savedProfile), null);
  assert.equal(repeatFieldGoesToAi(emptyDescription, savedProfile), false);
  assert.equal(repeatFieldGoesToAi(resolveRepeatField(field("学校"), new Map()), profile), true);
  assert.equal(repeatFieldGoesToAi(resolveRepeatField(field("学校"), new Map([["education:school:out", 1]])), profile), false);
});

test("project blocks with generic labels use their section heading", () => {
  const savedProfile = { ...profile, projects: [
    { name: "招聘数据看板", role: "负责人", start: "2025-01", end: "2025-03", description: "搭建可视化看板", responsibilities: "" },
  ] };
  const field = (label, section) => ({ label, placeholder: "", name: "", tag: "input", type: "text", section });
  const rows = new Map();
  assert.equal(matchBasicField(field("名称", "项目经历"), savedProfile, rows), "招聘数据看板");
  assert.equal(matchBasicField(field("担任角色", "项目经历"), savedProfile, rows), "负责人");
  assert.equal(matchBasicField(field("开始时间", "项目经历"), savedProfile, rows), "2025-01");
  assert.equal(matchBasicField(field("名称", "奖项"), savedProfile, new Map()), null);
});

test("old application profiles remain readable and project details reach the AI digest", () => {
  const profileSource = fs.readFileSync(path.join(__dirname, "../src/lib/application-profile.ts"), "utf8");
  const compiled = ts.transpileModule(profileSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const profileModule = { exports: {} };
  vm.runInNewContext(compiled, { module: profileModule, exports: profileModule.exports, require });
  const { parseApplicationProfile, describeApplicationProfile, mergeProjectRows } = profileModule.exports;
  assert.equal(parseApplicationProfile({ education: [], experiences: [], extras: {} }).projects.length, 0);
  const structured = parseApplicationProfile({
    projects: [{ name: "招聘数据看板", role: "负责人", responsibilities: "负责数据建模" }],
  });
  assert.equal(structured.projects[0].name, "招聘数据看板");
  assert.match(describeApplicationProfile(structured), /招聘数据看板.*负责数据建模/);
  const extracted = [{ name: "招聘数据看板", role: "成员", start: "2025-01", end: "", description: "简历摘要", responsibilities: "" }];
  const merged = mergeProjectRows(structured.projects, extracted);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].responsibilities, "负责数据建模");
  assert.equal(merged[0].start, "2025-01");
});

test("only hand-written or edited answers are confirmed", () => {
  const drafts = [{ answerId: "answer-1", filledValue: "AI 草稿" }];
  assert.equal(memoryCandidate({ value: "AI 草稿", answerId: "answer-1" }, drafts), null);
  assert.equal(memoryCandidate({ value: "项目描述", profileFilled: true }, drafts), null);
  assert.equal(memoryCandidate({ value: "我改写的回答", answerId: "answer-1" }, drafts).answerId, "answer-1");
  assert.equal(memoryCandidate({ value: "我手写的回答", answerId: null }, drafts).value, "我手写的回答");
  assert.equal(memoryCandidate({ value: "网站预填", userEdited: false }, drafts, true), null);
  assert.equal(memoryCandidate({ value: "AI 草稿", answerId: "answer-1", userEdited: true, editedAt: Date.now() - 4000 }, drafts, true), null);
  assert.equal(memoryCandidate({ value: "我亲手写的回答", userEdited: true, editedAt: Date.now() - 4000 }, drafts, true).value, "我亲手写的回答");
  assert.equal(memoryCandidate({ value: "还没写完", userEdited: true, editedAt: Date.now() }, drafts, true), null);
  assert.equal(memoryCandidate({ value: "我改过的学校", profileFilled: true, userEdited: true, editedAt: Date.now() - 4000 }, drafts, true).value, "我改过的学校");
});

test("manually entered basic facts are reusable, company-specific fields stay local", () => {
  const field = (label, options) => ({ label, placeholder: "", name: "", tag: "input", type: "text", options });
  assert.equal(fieldMemoryKey(field("毕业院校 *")), "学校");
  assert.equal(fieldMemoryKey(field("详细地址")), "地址");
  assert.equal(fieldMemoryKey(field("内部岗位编号")), "内部岗位编号");
  // Someone else's details are never remembered as the applicant's own.
  for (const label of ["密码", "身份证号码", "银行卡号", "验证码", "紧急联系人", "学校推荐人", "父亲姓名"]) {
    assert.equal(isForbiddenMemoryField(field(label)), true, label);
    assert.equal(fieldMemoryKey(field(label)), null, label);
  }
  const memories = [
    { questionLabel: "学校", answer: "通用大学", contextKey: null },
    { questionLabel: "学校", answer: "本企业校区", contextKey: "https://one.example" },
    { questionLabel: "地址", answer: "Singapore", contextKey: null },
    { questionLabel: "内部推荐码", answer: "ONE123", contextKey: "https://one.example" },
  ];
  assert.equal(matchRememberedField(field("毕业院校"), memories, "https://two.example"), "通用大学");
  assert.equal(matchRememberedField(field("毕业院校"), memories, "https://one.example"), "本企业校区");
  assert.equal(matchRememberedField(field("通讯地址"), memories, "https://two.example"), "Singapore");
  assert.equal(matchRememberedField(field("内部推荐码"), memories, "https://two.example"), null);
  assert.equal(matchRememberedField(field("内部推荐码"), memories, "https://one.example"), "ONE123");
  assert.equal(matchRememberedField(field("性别", ["男", "女"]), [{ questionLabel: "性别", answer: "未知", contextKey: null }], "https://one.example"), null);
});

test("automatic memory marks trusted typing, not synthetic autofill events", () => {
  const listeners = {};
  context.document = { addEventListener: (type, callback) => { listeners[type] = callback; } };
  trackUserEdits();
  const attrs = new Map();
  const field = { matches: () => true, disabled: false, readOnly: false, setAttribute: (key, value) => attrs.set(key, value) };
  listeners.input({ isTrusted: false, target: field });
  assert.equal(attrs.size, 0);
  listeners.input({ isTrusted: true, target: field });
  assert.equal(attrs.get("data-cp-user-edited"), "1");
  assert.ok(Number(attrs.get("data-cp-user-edited-at")) > 0);
});

test("confirmed global answers cannot be overwritten from another portal", () => {
  const scopeSource = fs.readFileSync(path.join(__dirname, "../src/lib/autofill-answer-scope.ts"), "utf8");
  const compiled = ts.transpileModule(scopeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const scopeModule = { exports: {} };
  vm.runInNewContext(compiled, { module: scopeModule, exports: scopeModule.exports, require });
  const { canUpdateReferencedAnswer, shouldForkGlobalAnswer } = scopeModule.exports;
  assert.equal(canUpdateReferencedAnswer({ confirmed: true, contextKey: null }, "https://careers.example.com", "https://careers.example.com"), false);
  assert.equal(canUpdateReferencedAnswer({ confirmed: true, contextKey: "https://careers.example.com" }, "https://careers.example.com", "https://careers.example.com"), true);
  assert.equal(canUpdateReferencedAnswer({ confirmed: false, contextKey: "https://careers.example.com" }, null, "https://careers.example.com"), true);
  assert.equal(shouldForkGlobalAnswer({ contextKey: null, answer: "通用回答" }, "https://careers.another.com", "为这家公司重写"), true);
  assert.equal(shouldForkGlobalAnswer({ contextKey: null, answer: "通用回答" }, "https://careers.another.com", "通用回答"), false);
  assert.equal(shouldForkGlobalAnswer({ contextKey: "https://careers.example.com", answer: "旧答案" }, "https://careers.example.com", "新答案"), false);
});

test("browser IPC rejects guest frames and an external main-window navigation", () => {
  const origin = "http://localhost:3210";
  const mainFrame = { url: `${origin}/browser` };
  const contents = { mainFrame, getURL: () => `${origin}/browser`, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  assert.doesNotThrow(() => assertTrustedBrowserEvent({ sender: contents, senderFrame: mainFrame }, window, origin));
  assert.throws(() => assertTrustedBrowserEvent({ sender: contents, senderFrame: { url: `${origin}/browser` } }, window, origin));
  assert.throws(() => assertTrustedBrowserEvent({ sender: { ...contents }, senderFrame: mainFrame }, window, origin));
  const external = { ...contents, getURL: () => "https://example.com" };
  assert.throws(() => assertTrustedBrowserEvent({ sender: external, senderFrame: mainFrame }, { webContents: external, isDestroyed: () => false }, origin));
});

test("untrusted download filenames and external protocols stay constrained", () => {
  assert.equal(safeDownloadFilename("../../secret.txt"), "secret.txt");
  assert.equal(safeDownloadFilename("..\\..\\offer.pdf"), "offer.pdf");
  assert.equal(safeDownloadFilename(".."), "download");
  assert.equal(openSafeExternalUrl("file:///private/data"), false);
  assert.equal(openSafeExternalUrl("javascript:alert(1)"), false);
});

test("local server rejects DNS rebinding and cross-site browser requests", () => {
  const guardSource = fs.readFileSync(path.join(__dirname, "../src/lib/local-request-guard.ts"), "utf8");
  const compiled = ts.transpileModule(guardSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const guardModule = { exports: {} };
  vm.runInNewContext(compiled, { module: guardModule, exports: guardModule.exports, require, URL });
  const { isTrustedLocalRequest } = guardModule.exports;
  assert.equal(isTrustedLocalRequest(new Headers({ host: "localhost:3210", origin: "http://localhost:3210", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isTrustedLocalRequest(new Headers({ host: "127.0.0.1:4567" })), true);
  assert.equal(isTrustedLocalRequest(new Headers({ host: "evil.example:3210", origin: "http://evil.example:3210" })), false);
  assert.equal(isTrustedLocalRequest(new Headers({ host: "localhost:3210", origin: "https://evil.example" })), false);
  assert.equal(isTrustedLocalRequest(new Headers({ host: "localhost:3210", "sec-fetch-site": "cross-site" })), false);
  assert.equal(isTrustedLocalRequest(new Headers({ host: "localhost.evil.example:3210" })), false);
});
