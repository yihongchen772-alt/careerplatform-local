const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relative, extraRequire = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: (name) => extraRequire[name] ?? require(name), URL, Buffer, process });
  return mod.exports;
}

const { isExtensionApiRequest, isTrustedLocalRequest } = loadTs("src/lib/local-request-guard.ts");
const EXTENSION_ORIGIN = `chrome-extension://${"a".repeat(16)}${"p".repeat(16)}`;

test("only the paired extension's origin reaches /api/extension, and nothing else", () => {
  const headers = (extra) => new Headers({ host: "localhost:3210", ...extra });
  assert.equal(isExtensionApiRequest("/api/extension/profile", headers({ origin: EXTENSION_ORIGIN, "x-jobcompass-token": "t" })), true);
  assert.equal(isExtensionApiRequest("/api/extension/profile", headers({ origin: EXTENSION_ORIGIN })), false, "needs the pairing header");
  assert.equal(isExtensionApiRequest("/api/desktop-browser/profile", headers({ origin: EXTENSION_ORIGIN, "x-jobcompass-token": "t" })), false, "other routes stay closed");
  assert.equal(isExtensionApiRequest("/api/extension/profile", headers({ origin: "https://evil.example", "x-jobcompass-token": "t" })), false);
  assert.equal(isExtensionApiRequest("/api/extension/profile", headers({ origin: "chrome-extension://short", "x-jobcompass-token": "t" })), false);
  assert.equal(isExtensionApiRequest("/api/extension/profile", new Headers({ host: "evil.example:3210", origin: EXTENSION_ORIGIN, "x-jobcompass-token": "t" })), false, "DNS rebinding");
  // The app's own pages still don't accept extension-origin requests.
  assert.equal(isTrustedLocalRequest(headers({ origin: EXTENSION_ORIGIN })), false);
});

test("pairing codes are random, hashed, and compared in constant time", async () => {
  const stored = { extensionTokenHash: null };
  const auth = loadTs("src/lib/extension-auth.ts", {
    "@/lib/db": { db: { user: { findUnique: async () => stored } } },
    "@/lib/session": { LOCAL_USER_ID: "local-user" },
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init && init.status }) } },
  });
  const token = auth.newExtensionToken();
  assert.match(token, /^[\w-]{30,}$/);
  assert.notEqual(token, auth.newExtensionToken());
  const request = (value) => new Request("http://localhost/api/extension/status", { headers: value ? { "x-jobcompass-token": value } : {} });
  assert.equal((await auth.rejectUnpairedExtension(request(token))).status, 401, "nothing paired yet");
  stored.extensionTokenHash = auth.hashExtensionToken(token);
  assert.equal(await auth.rejectUnpairedExtension(request(token)), null);
  assert.equal((await auth.rejectUnpairedExtension(request(`${token}x`))).status, 401);
  assert.equal((await auth.rejectUnpairedExtension(request(null))).status, 401);
});

test("the built extension carries the desktop app's own autofill engine", () => {
  const { buildExtension } = require("../scripts/build-extension.cjs");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "jobcompass-extension-"));
  try {
    const { version } = buildExtension(out);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, version);
    assert.equal(version, require("../package.json").version);
    for (const file of ["background.js", "popup.html", "popup.js", "popup.css", "icons/icon-128.png", "lib/autofill-core.js"]) {
      assert.ok(fs.existsSync(path.join(out, file)), file);
    }
    // The wrapper must run in a service worker (no require/module globals).
    const worker = { self: {}, URL, URLSearchParams };
    worker.self = worker;
    vm.runInNewContext(fs.readFileSync(path.join(out, "lib/autofill-core.js"), "utf8"), worker);
    const core = worker.JobCompassCore;
    for (const name of ["runAutofillCore", "saveCorrectionsCore", "scanPageFields", "fillFields", "attachResumeFile", "showPageStatus", "capturePageText", "detectApplicationSuccess", "markResumeFileInputs"]) {
      assert.equal(typeof core[name], "function", name);
    }
    assert.equal(core.matchBasicField({ label: "学校", placeholder: "", name: "", tag: "input", type: "text" }, { education: [{ school: "东南大学", degree: "本科" }] }, new Map()), "东南大学");
    // Nothing in the bundle may reach for Node or Electron.
    assert.doesNotMatch(fs.readFileSync(path.join(out, "lib/autofill-core.js"), "utf8"), /require\(/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("runAutofillCore drives any adapter the same way", async () => {
  const core = require("../electron/autofill-core.js");
  const statuses = [];
  const filledWith = [];
  const field = (id, label) => ({ id, tag: "input", type: "text", label, placeholder: "", name: "", section: "", hasValue: false });
  const adapter = {
    url: () => "https://careers.example.com/apply",
    stillOnPage: () => true,
    frames: async () => ["top"],
    run: async (_frame, fn, args) => {
      if (fn === core.scanPageFields) return [field(`${args[0]}f0`, "姓名"), field(`${args[0]}f1`, "学校")];
      if (fn === core.fillFields) {
        filledWith.push(...args[0]);
        return { filled: args[0].map((p) => p.id), failed: [] };
      }
      return undefined;
    },
    api: async (name) => ({ ok: true, json: async () => (name.startsWith("profile") ? { name: "测试", education: [{ school: "东南大学" }], fieldMemories: [] } : {}) }),
    status: (payload) => statuses.push(payload),
    uploadResume: async () => 0,
    getDrafts: () => [],
    setDrafts: () => {},
  };
  const result = await core.runAutofillCore(adapter, undefined, {});
  assert.equal(result.phase, "done");
  assert.deepEqual(filledWith.map((p) => p.value), ["测试", "东南大学"]);
  assert.equal(statuses[0].phase, "scanning");
  assert.equal(statuses.at(-1).phase, "done");
  assert.match(result.message, /已验证填入 2 个基础字段/);
});

test("a selection made while AI is pending is preserved and reported as existing content", async () => {
  const core = require("../electron/autofill-core.js");
  const statuses = [];
  let id;
  const adapter = {
    url: () => "https://careers.example.com/apply",
    stillOnPage: () => true,
    frames: async () => ["top"],
    run: async (_frame, fn, args) => {
      if (fn === core.scanPageFields) {
        id = `${args[0]}r0`;
        return [{ id, tag: "radio", label: "是否接受调剂", options: ["是", "否"], hasValue: false }];
      }
      if (fn === core.fillFields) return { filled: [], failed: [], skipped: [id] };
    },
    api: async (name) => ({ ok: true, json: async () => name.startsWith("profile") ? {} : { answers: [{ id, answer: "是" }] } }),
    status: (payload) => statuses.push(payload),
    uploadResume: async () => 0,
    getDrafts: () => [],
    setDrafts: () => {},
  };
  const result = await core.runAutofillCore(adapter, "resume-test");
  assert.equal(result.phase, "done");
  assert.match(statuses.find((s) => s.phase === "ai").message, /已验证填入/);
  assert.match(result.message, /1 个填写期间已有修改的字段已保留/);
  assert.doesNotMatch(result.message, /需要自己填|未通过写入验证/);
  assert.equal(result.details[0].source, "prefilled");
});

test("injected writers preserve a newly selected radio, dropdown, or manually cleared input", async () => {
  const core = require("../electron/autofill-core.js");
  const inputPrototype = {};
  Object.defineProperty(inputPrototype, "value", { set(value) { this.value = value; } });
  const input = { tagName: "INPUT", value: "", getAttribute: () => "1" };
  const radio = { checked: true, getAttribute: () => null };
  const dropdown = {
    classList: { contains: () => false },
    getAttribute: () => null,
    querySelector: (selector) => selector.includes("selection-item") ? { textContent: "已手选" } : null,
    matches: () => false,
  };
  const sandbox = vm.createContext({
    window: { HTMLInputElement: { prototype: inputPrototype }, HTMLTextAreaElement: { prototype: inputPrototype } },
    document: { querySelectorAll: () => [radio], querySelector: (selector) => selector.includes("test-s0") ? dropdown : input },
  });
  const fill = vm.runInContext(`(${core.fillFields.toString()})`, sandbox);
  const custom = vm.runInContext(`(${core.fillCustomSelects.toString()})`, sandbox);
  const result = await fill([{ id: "test-r0", value: "是" }, { id: "test-f0", value: "旧资料", tag: "input" }]);
  assert.deepEqual(Array.from(result.skipped), ["test-r0", "test-f0"]);
  assert.equal(result.filled.length, 0);
  assert.equal(result.failed.length, 0);
  const selected = await custom([{ id: "test-s0", value: "旧资料" }]);
  assert.deepEqual(Array.from(selected.skipped), ["test-s0"]);
  assert.equal(selected.filled.length, 0);
});

test("module selection limits fields, AI questions, add buttons and resume uploads together", async () => {
  const core = require("../electron/autofill-core.js");
  const writes = [];
  const questions = [];
  const addGroups = [];
  let uploads = 0;
  const fields = [
    { id: "c0-f0", label: "邮箱", section: "基本信息", hasValue: false },
    { id: "c0-f1", label: "学校", section: "教育经历", hasValue: false },
    { id: "c0-f2", label: "公司", section: "实习经历", hasValue: false },
    { id: "c0-f3", label: "项目名称", section: "项目经历", hasValue: true },
    { id: "c0-f4", label: "项目名称", section: "项目经历", hasValue: false },
    { id: "c0-f5", label: "请说明使用的技术", section: "项目经历", hasValue: false },
    { id: "c0-f6", label: "为什么申请？", section: "开放题", hasValue: false },
  ].map((field) => ({ tag: "input", type: "text", placeholder: "", name: "", ...field }));
  const profile = { email: "test@example.invalid", education: [{ school: "学校一" }, { school: "学校二" }], experiences: [{ company: "公司一" }, { company: "公司二" }], projects: [{ name: "项目一" }, { name: "项目二" }, { name: "项目三" }] };
  const adapter = {
    url: () => "https://careers.example.com/apply",
    stillOnPage: () => true,
    frames: async () => ["top"],
    run: async (_frame, fn, args) => {
      if (fn === core.scanPageFields) return fields;
      if (fn === core.fillFields) { writes.push(...args[0]); return { filled: args[0].map((p) => p.id), failed: [] }; }
      if (fn === core.clickAddBlock) { addGroups.push(args[0]); return { clicked: false }; }
    },
    api: async (name, init) => {
      if (name.startsWith("profile")) return { ok: true, json: async () => profile };
      questions.push(...JSON.parse(init.body).questions);
      return { ok: true, json: async () => ({ answers: questions.map((q) => ({ id: q.id, answer: "测试技术" })) }) };
    },
    status: () => {},
    uploadResume: async () => { uploads++; return 1; },
    getDrafts: () => [],
    setDrafts: () => {},
  };
  const result = await core.runAutofillCore(adapter, "resume-test", { modules: ["project"], expandBlocks: true });
  assert.equal(result.phase, "done");
  assert.deepEqual(writes.map((p) => p.id), ["c0-f4", "c0-f5"]);
  assert.equal(writes[0].value, "项目二", "prefilled first project still consumes row one");
  assert.deepEqual(questions.map((q) => q.id), ["c0-f5"]);
  assert.deepEqual(addGroups, ["project"]);
  assert.equal(uploads, 0, "using a resume for AI must not upload it when attachment module is unchecked");
  assert.equal(result.details.filter((d) => d.source === "excluded").length, 4);
  assert.match(result.message, /4 个不在填写范围内的字段已跳过/);
  assert.doesNotMatch(result.message, /段教育经历|段实习/);
  writes.length = 0;
  questions.length = 0;
  addGroups.length = 0;
  const uploadOnly = await core.runAutofillCore(adapter, "resume-test", { modules: ["resume"], expandBlocks: true });
  assert.equal(uploadOnly.phase, "done");
  assert.equal(uploads, 1);
  assert.equal(writes.length, 0);
  assert.equal(questions.length, 0);
  assert.equal(addGroups.length, 0);
  const empty = await core.runAutofillCore({ url: adapter.url, status: () => {} }, "resume-test", { modules: [] });
  assert.equal(empty.phase, "error");
  assert.match(empty.message, /至少勾选一个模块/);
});

test("module classification uses the section for generic fields and leaves unknown fields separate", () => {
  const { fieldModule, resolveRepeatField } = require("../electron/autofill-core.js");
  const cases = [
    ["学校", "教育经历", "education"],
    ["专业课程", "教育经历", "education"],
    ["名称", "项目经历", "project"],
    ["描述", "实习经历", "experience"],
    ["手机", "", "basic"],
    ["期望岗位", "求职意向", "basic"],
    ["自我评价", "", "questions"],
    ["为什么申请？", "", "questions"],
    ["未知字段", "", "other"],
  ];
  for (const [label, section, expected] of cases) {
    const field = { label, section, tag: "input", type: "text", placeholder: "", name: "" };
    assert.equal(fieldModule(field, resolveRepeatField(field, new Map())), expected, label);
  }
});

test("profile fields are written before waiting for AI, and malformed or duplicate AI answers cannot spoil them", async () => {
  const core = require("../electron/autofill-core.js");
  const writes = [];
  const statuses = [];
  const adapter = {
    url: () => "https://careers.example.com/apply",
    stillOnPage: () => true,
    frames: async () => ["top"],
    run: async (_frame, fn, args) => {
      if (fn === core.scanPageFields) return [
        { id: "c0-f0", tag: "input", type: "text", label: "姓名", hasValue: false },
        { id: "c0-f1", tag: "textarea", label: "为什么申请？", hasValue: false },
      ];
      if (fn === core.fillFields) { writes.push(...args[0]); return { filled: args[0].map((p) => p.id), failed: [] }; }
    },
    api: async (name) => {
      if (name.startsWith("profile")) return { ok: true, json: async () => ({ name: "测试姓名" }) };
      assert.deepEqual(writes.map((p) => p.value), ["测试姓名"], "facts must already be visible when AI starts");
      return { ok: true, json: async () => ({ answers: [null, { id: "c0-f1", answer: null }, { id: "c0-f1", answer: "有效回答" }, { id: "c0-f1", answer: "重复回答" }, { id: "unknown", answer: "无关回答" }] }) };
    },
    status: (s) => statuses.push(s),
    uploadResume: async () => 0,
    getDrafts: () => [], setDrafts: () => {},
  };
  const result = await core.runAutofillCore(adapter, "resume");
  assert.equal(result.phase, "done");
  assert.deepEqual(writes.map((p) => p.value), ["测试姓名", "有效回答"]);
  assert.equal(result.summary.filled, 2);
  assert.equal(result.summary.manual, 0);
  assert.match(statuses.find((s) => s.phase === "ai").message, /已验证填入 1 个资料字段/);
});

test("changing pages after profile filling stops AI writes and attachments", async () => {
  const core = require("../electron/autofill-core.js");
  let samePage = true;
  let uploads = 0;
  const writes = [];
  const adapter = {
    url: () => "https://careers.example.com/apply", stillOnPage: () => samePage,
    frames: async () => ["top"],
    run: async (_frame, fn, args) => {
      if (fn === core.scanPageFields) return [{ id: "c0-f0", tag: "input", label: "姓名", hasValue: false }, { id: "c0-f1", tag: "textarea", label: "为什么申请？", hasValue: false }];
      if (fn === core.fillFields) { writes.push(...args[0]); return { filled: args[0].map((p) => p.id), failed: [] }; }
    },
    api: async (name) => {
      if (name.startsWith("profile")) return { ok: true, json: async () => ({ name: "测试姓名" }) };
      samePage = false;
      return { ok: true, json: async () => ({ answers: [{ id: "c0-f1", answer: "回答" }] }) };
    },
    status: () => {}, uploadResume: async () => { uploads++; return 1; },
    getDrafts: () => [], setDrafts: () => {},
  };
  const result = await core.runAutofillCore(adapter, "resume");
  assert.equal(result.phase, "error");
  assert.match(result.message, /页面或标签已切换/);
  assert.deepEqual(writes.map((p) => p.id), ["c0-f0"]);
  assert.equal(uploads, 0);
});

test("ambiguous partial dropdown values are left for the user", () => {
  const { matchFieldOption } = require("../electron/autofill-core.js");
  assert.equal(matchFieldOption({ options: ["北京", "上海"] }, "北京"), "北京");
  assert.equal(matchFieldOption({ options: ["北京市", "上海市"] }, "北京"), "北京市");
  assert.equal(matchFieldOption({ options: ["北京校区", "北京总部"] }, "北京"), null);
});

test("a native select's nonempty placeholder is fillable, but a real selected option is preserved", async () => {
  const core = require("../electron/autofill-core.js");
  const prototype = {};
  Object.defineProperty(prototype, "value", { set(value) { this.value = value; } });
  const select = {
    tagName: "SELECT", selectedIndex: 0,
    options: [{ value: "0", textContent: "请选择性别", disabled: true }, { value: "f", textContent: "女", disabled: false }, { value: "m", textContent: "男", disabled: false }],
    getAttribute: () => null, setAttribute: () => {}, dispatchEvent: () => {},
    style: { setProperty: () => {} },
  };
  Object.defineProperty(select, "value", { get() { return this.options[this.selectedIndex].value; }, set(value) { this.selectedIndex = this.options.findIndex((o) => o.value === value); } });
  const sandbox = vm.createContext({
    window: { HTMLInputElement: { prototype }, HTMLTextAreaElement: { prototype } },
    document: { querySelector: () => select }, Event: class {}, setTimeout: (fn) => fn(),
  });
  const fill = vm.runInContext(`(${core.fillFields.toString()})`, sandbox);
  const result = await fill([{ id: "test-f0", tag: "select", value: "女" }]);
  assert.deepEqual(Array.from(result.filled), ["test-f0"]);
  assert.equal(select.value, "f");
  const again = await fill([{ id: "test-f0", tag: "select", value: "男" }]);
  assert.deepEqual(Array.from(again.skipped), ["test-f0"]);
  assert.equal(select.value, "f");
});

test("already uploaded resumes lose stale markers and cannot be replaced by the extension", () => {
  const core = require("../electron/autofill-core.js");
  const makeInput = (files) => {
    const attrs = { "data-cp-resume-upload": "1" };
    return { name: "resume", id: "", files,
      removeAttribute: (key) => { delete attrs[key]; }, setAttribute: (key, value) => { attrs[key] = value; },
      getAttribute: (key) => key === "accept" ? "application/pdf" : attrs[key] ?? null,
      closest: () => null,
    };
  };
  const empty = makeInput([]);
  const uploaded = makeInput([{ name: "用户已选.pdf" }]);
  const sandbox = vm.createContext({ document: { querySelectorAll: () => [empty, uploaded] } });
  const mark = vm.runInContext(`(${core.markResumeFileInputs.toString()})`, sandbox);
  assert.equal(mark(), 1);
  assert.equal(empty.getAttribute("data-cp-resume-upload"), "1");
  assert.equal(uploaded.getAttribute("data-cp-resume-upload"), null);
  sandbox.document.querySelectorAll = () => [uploaded];
  sandbox.atob = () => "x";
  const attach = vm.runInContext(`(${core.attachResumeFile.toString()})`, sandbox);
  assert.equal(attach("eA==", "新的简历.pdf", "application/pdf"), 0);
  assert.equal(uploaded.files[0].name, "用户已选.pdf");
});

test("an untouched AI draft is never remembered, even with the draft list lost", async () => {
  const core = require("../electron/autofill-core.js");
  const posted = [];
  const essay = (id, label) => ({ id, tag: "textarea", type: "", label, placeholder: "", name: "", section: "", hasValue: true });
  const values = {
    "c0-f0": { value: "AI 写的草稿", answerId: "draft-1", userEdited: false },
    "c0-f1": { value: "我自己改过的回答", answerId: "draft-2", userEdited: true, editedAt: 1 },
    "c0-f2": { value: "我手写的回答", answerId: null, userEdited: true, editedAt: 1 },
  };
  const adapter = {
    url: () => "https://careers.example.com/apply",
    frames: async () => ["top"],
    run: async (_frame, fn, args) => {
      if (fn === core.scanPageFields) return [essay("c0-f0", "为什么选择我们？"), essay("c0-f1", "你的职业规划？"), essay("c0-f2", "请介绍一个项目经历？")];
      if (fn === core.readFieldValues) return { [args[0][0]]: values[args[0][0]] };
      return undefined;
    },
    api: async (_name, init) => {
      posted.push(...JSON.parse(init.body).answers);
      return { ok: true, json: async () => ({ saved: posted.length }) };
    },
    getDrafts: () => [], // e.g. the extension worker was suspended
    setDrafts: () => {},
  };
  const result = await core.saveCorrectionsCore(adapter, undefined, false);
  assert.equal(result.saved, 2);
  assert.deepEqual(posted.map((a) => a.answer).sort(), ["我手写的回答", "我自己改过的回答"]);
});

test("automatically added blocks retain earlier verified counts and field sources", async () => {
  const core = require('../electron/autofill-core.js');
  let count = 1;
  const completed = new Set();
  const adapter = {
    url: () => 'https://fixture.example/apply', stillOnPage: () => true,
    frames: async () => ['top'],
    run: async (_frame, fn, args) => {
      if (fn === core.scanPageFields) return Array.from({ length: count }, (_, i) => ({ id: `${args[0]}f${i}`, resultKey: `school-${i}`, label: '学校', section: '教育经历', tag: 'input', hasValue: completed.has(i) }));
      if (fn === core.fillFields) { for (const p of args[0]) completed.add(Number(p.id.match(/f(\d+)$/)[1])); return { filled: args[0].map((p) => p.id), failed: [] }; }
      if (fn === core.clickAddBlock) { count++; return { clicked: true }; }
    },
    api: async () => ({ ok: true, json: async () => ({ education: [{ school: '大学 A' }, { school: '大学 B' }, { school: '大学 C' }] }) }),
    status() {}, uploadResume: async () => 0, getDrafts: () => [], setDrafts() {},
  };
  const result = await core.runAutofillCore(adapter, undefined, { expandBlocks: true, modules: ['education'] });
  assert.equal(result.summary.filled, 3); assert.equal(result.summary.preserved, 0);
  assert.equal(result.details.length, 3); assert.ok(result.details.every((d) => d.source === 'profile'));
  assert.match(result.message, /本次累计填入 3 个字段/);
});

test("cancelled AI request keeps profile values and never uploads or writes AI", async () => {
  const core = require('../electron/autofill-core.js');
  let stopped = false, uploads = 0; const writes = [];
  const adapter = {
    url: () => 'https://fixture.example/apply', stillOnPage: () => !stopped, stopReason: () => stopped ? '已停止填写，已填入的内容保留' : null,
    frames: async () => ['top'],
    run: async (_frame, fn) => {
      if (fn === core.scanPageFields) return [{ id: 'f0', label: '姓名', tag: 'input', hasValue: false }, { id: 'f1', label: '为什么选择我们？', tag: 'textarea', hasValue: false }];
      if (fn === core.fillFields) { writes.push('profile'); return { filled: ['f0'], failed: [] }; }
    },
    api: async (name) => {
      if (name.startsWith('profile')) return { ok: true, json: async () => ({ name: '虚构姓名' }) };
      stopped = true; throw new Error('aborted');
    },
    status() {}, uploadResume: async () => { uploads++; }, getDrafts: () => [], setDrafts() {},
  };
  const result = await core.runAutofillCore(adapter, 'resume');
  assert.match(result.message, /已停止填写/); assert.deepEqual(writes, ['profile']); assert.equal(uploads, 0);
});

function workerFixture() {
  const events = () => { const listeners = new Set(); return { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn), fire: (...args) => [...listeners].forEach((fn) => fn(...args)), size: () => listeners.size }; };
  const updated = events(), history = events(); let failInit = true, cleared = 0, coreRuns = 0;
  const sandbox = {
    self: { JobCompassCore: { runAutofillCore: async () => { coreRuns++; return { phase: 'done' }; } } }, importScripts() {},
    chrome: { tabs: { get: async () => { if (failInit) throw new Error('closed fixture tab'); return { url: 'https://fixture.example/apply' }; }, onUpdated: updated, onRemoved: events() },
      webNavigation: { getAllFrames: async () => [{ frameId: 0 }], onHistoryStateUpdated: history },
      scripting: { executeScript: async () => [{ result: null }] },
      storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} }, local: { get: async () => ({}) } },
      runtime: { sendMessage: async () => {}, onMessage: events(), getPlatformInfo: async () => {} }, commands: { onCommand: events() } },
    crypto: require('node:crypto').webcrypto, AbortController, URL, URLSearchParams, setInterval: () => 1, clearInterval: () => { cleared++; }, console,
  };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), sandbox);
  return { sandbox, updated, history, allowInit: () => { failInit = false; }, cleared: () => cleared, coreRuns: () => coreRuns };
}
test("extension initialization failure releases running flag and keepalive; next fill can start", async () => {
  const f = workerFixture(); const result = await vm.runInContext('fillTab(1, {})', f.sandbox);
  assert.equal(result.phase, 'error'); assert.equal(f.cleared(), 1);
  assert.equal(vm.runInContext('running.size', f.sandbox), 0); assert.equal(vm.runInContext('tasks.size', f.sandbox), 0);
  f.allowInit(); await vm.runInContext('fillTab(1, {})', f.sandbox); assert.equal(f.coreRuns(), 1); assert.equal(f.cleared(), 2);
});
test("extension reload at the same URL invalidates its task even if URL returns unchanged", async () => {
  const f = workerFixture(); f.allowInit();
  const ready = await vm.runInContext('tasks.set(1, { id: "fixture", controller: new AbortController() }); adapterFor(1, tasks.get(1))', f.sandbox);
  assert.equal(ready.adapter.stillOnPage('https://fixture.example/apply'), true);
  f.updated.fire(1, { status: 'loading' });
  assert.equal(ready.adapter.stillOnPage('https://fixture.example/apply'), false);
  ready.dispose(); assert.equal(f.updated.size(), 0);
});

test('cancellation while a custom dropdown opens prevents the option click', async () => {
  const core = require('../electron/autofill-core.js'); let active = true, optionClicks = 0;
  const trigger = { dispatchEvent() {}, click() {} };
  const container = { classList: { contains: () => false }, getAttribute: () => null, matches: () => false,
    querySelector: (selector) => selector === "input:not([type='hidden'])" ? trigger : null };
  const sandbox = vm.createContext({ document: { documentElement: { getAttribute: () => active ? 'fixture-task' : null }, querySelector: () => container, querySelectorAll: () => [{ click: () => optionClicks++, getBoundingClientRect: () => ({ width: 100, height: 30 }) }] },
    MouseEvent: class {}, setTimeout: (fn) => { active = false; fn(); } });
  const fill = vm.runInContext(`(${core.fillCustomSelects.toString()})`, sandbox);
  await assert.rejects(fill([{ id: 'field-s0', value: '北京' }], 'fixture-task'), /填写已停止/);
  assert.equal(optionClicks, 0);
});
