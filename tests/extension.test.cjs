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
