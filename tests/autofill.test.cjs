const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// The browser helpers live in Electron's main-process module. Evaluate its
// pure functions with Electron stubbed, without opening a window or website.
const source = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
const context = {
  require: (name) => name === "electron" ? {} : require(name),
  module: { exports: {} },
  URL,
};
vm.runInNewContext(`${source}\nmodule.exports.__test = { matchBasicField, matchRememberedField, fieldMemoryKey, isForbiddenMemoryField, isNeverGuessField, isOpenEndedQuestionField, isSensitiveMemoryField, portalContext, memoryCandidate, trackUserEdits, assertTrustedBrowserEvent, safeDownloadFilename, openSafeExternalUrl };`, context);
const { matchBasicField, matchRememberedField, fieldMemoryKey, isForbiddenMemoryField, isNeverGuessField, isOpenEndedQuestionField, isSensitiveMemoryField, portalContext, memoryCandidate, trackUserEdits, assertTrustedBrowserEvent, safeDownloadFilename, openSafeExternalUrl } = context.module.exports.__test;

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

test("company context survives own-site paths but isolates shared job board paths", () => {
  assert.equal(portalContext("https://careers.example.com/apply/123"), portalContext("https://careers.example.com/candidate/456"));
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
  assert.equal(matchBasicField(field("项目职责"), savedProfile, indexes), "负责数据建模");
  assert.equal(matchBasicField(field("项目经历"), savedProfile, indexes), "招聘数据看板；负责人；搭建可视化看板；负责数据建模");
  assert.equal(matchBasicField(field("项目名称"), savedProfile, new Map([["name", 1]])), "课程推荐系统");
  assert.equal(matchBasicField(field("Project Name"), profile, new Map()), null);
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
  assert.equal(fieldMemoryKey(field("学校推荐人")), "学校推荐人");
  for (const label of ["密码", "身份证号码", "银行卡号", "验证码", "紧急联系人"]) {
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
