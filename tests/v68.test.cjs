const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");
const { setupUpdater, CHANNELS } = require("../electron/updater");

function loadTs(relFile, mocks = {}) {
  const abs = path.resolve(__dirname, "..", relFile);
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const ctx = {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (mocks[id]) return mocks[id];
      if (id.startsWith("@/")) {
        const sub = `src/${id.slice(2)}`;
        const candidate = fs.existsSync(path.resolve(__dirname, "..", `${sub}.ts`))
          ? `${sub}.ts`
          : `${sub}/index.ts`;
        return loadTs(candidate, mocks);
      }
      return require(id);
    },
    console,
    Date,
    Error,
    Buffer,
    URL,
    Intl,
    process,
    Set,
    Map,
    Array,
    AbortSignal,
    fetch: mocks.__fetch ?? globalThis.fetch,
  };
  vm.runInNewContext(source, ctx);
  return mod.exports;
}

test("resolveAutofillAttachments respects pinned role selection over newer uploads", () => {
  const roles = loadTs("src/lib/attachment-roles.ts");
  const resolved = roles.resolveAutofillAttachments(
    [
      { id: "old-photo", name: "一寸照-精修.jpg", url: "/api/files/library/old.jpg", category: "证件照", createdAt: new Date("2026-01-01T00:00:00Z") },
      { id: "new-photo", name: "一寸照-最新.jpg", url: "/api/files/library/new.jpg", category: "证件照", createdAt: new Date("2026-02-01T00:00:00Z") },
      { id: "cert-1", name: "蓝桥杯国二.pdf", url: "/api/files/library/cert.pdf", category: "证书", createdAt: new Date("2026-01-15T00:00:00Z") },
    ],
    "陈同学",
    { photo: "old-photo", certificate: "non-existent" },
  );
  const photo = resolved.find((item) => item.role === "photo");
  const cert = resolved.find((item) => item.role === "certificate");
  assert.equal(photo.id, "old-photo");
  assert.equal(photo.name, "一寸照-精修.jpg");
  assert.equal(cert.id, "cert-1");
});

test("application-profile supports SOCIAL_FIELDS, 100 variants cap, and private field exclusion in AI text", () => {
  const profileLib = loadTs("src/lib/application-profile.ts");
  assert.ok(profileLib.SOCIAL_FIELDS.some((f) => f.key === "workYears"));
  assert.ok(profileLib.SOCIAL_FIELDS.some((f) => f.key === "currentSalary" && f.private));

  const variants = Array.from({ length: 100 }, (_, i) => ({
    id: `v-${i}`,
    name: `方案 ${i}`,
    experiences: [],
    projects: [],
    extras: i === 42 ? { targetRole: "后端研发" } : {},
  }));
  const parsed = profileLib.applicationProfileSchema.safeParse({
    variants,
    extras: { workYears: "3年", currentSalary: "25k*14", nonCompete: "无" },
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.variants.length, 100);

  const resolved = profileLib.resolveProfileVariant(parsed.data, "v-42");
  assert.equal(resolved.profile.extras.targetRole, "后端研发");
  assert.equal(resolved.profile.extras.workYears, "3年");

  const described = profileLib.describeApplicationProfile(resolved.profile);
  assert.match(described, /工作年限：3年/);
  assert.doesNotMatch(described, /25k\*14/);
  assert.doesNotMatch(described, /竞业协议/);
});

test("posting-match enforces ASCII word boundaries and structured resume fallback", () => {
  const match = loadTs("src/lib/posting-match.ts");
  const signal = match.extractProfileSignal(
    { targetTrack: "后端开发", preferredCities: "上海", graduationYear: 2027 },
    "",
    {
      headline: "专注高并发分布式系统",
      sections: [
        {
          heading: "技能",
          entries: [{ title: "技术栈", tags: ["Go", "Kubernetes"], bullets: [{ text: "使用 PostgreSQL 优化查询" }] }],
        },
      ],
    },
  );
  assert.ok(signal.trackTerms.includes("go"));
  assert.ok(signal.skillTerms.includes("kubernetes"));
  assert.ok(signal.skillTerms.includes("postgresql"));

  const algorithmOnly = match.scorePostingMatch(
    { companyName: "X", title: "算法工程师", tracks: "Algorithm", cities: "北京", description: "负责 React 前端组件与 algorithm 设计" },
    signal,
  );
  const backendGo = match.scorePostingMatch(
    { companyName: "Y", title: "后端开发工程师", tracks: "后端", cities: "上海", graduation: "2027届", description: "Go / Kubernetes / PostgreSQL" },
    signal,
  );
  assert.equal(algorithmOnly.reasons.some((r) => r.includes("go") || r.includes("c")), false);
  assert.ok(backendGo.score > algorithmOnly.score);
  assert.ok(backendGo.score >= 85);
});

test("inferBriefMode & parseInterviewBrief support exam mode and webUsed", () => {
  const briefLib = loadTs("src/lib/interview-brief.ts");
  assert.equal(briefLib.inferBriefMode("OA", null), "exam");
  assert.equal(briefLib.inferBriefMode("ASSESSMENT", "性格测评"), "exam");
  assert.equal(briefLib.inferBriefMode("SCREENING", "在线笔试"), "exam");
  assert.equal(briefLib.inferBriefMode("INTERVIEW_1", "业务一面"), "interview");

  const parsed = briefLib.parseInterviewBrief({
    mode: "exam",
    webUsed: true,
    summary: "重点测编程题与行测",
    focus: [],
    stories: [],
    questions: [{ question: "手撕 LRU", hint: "哈希+双向链表" }],
    askBack: [],
    reminders: [],
  });
  assert.equal(parsed.mode, "exam");
  assert.equal(parsed.webUsed, true);
  assert.equal(parsed.questions.length, 1);
});

test("summarizeDroppedHistory retains IDs and stays within character budget", () => {
  const llm = loadTs("src/lib/agent/llm.ts", { "@/lib/proxy-agent": { applyProxy() {} } });
  const summary = llm.summarizeDroppedHistory(
    [
      { role: "user", content: "帮我筛选腾讯和字节的后端投递" },
      { role: "assistant", content: "已查到 2 条记录", refs: "app-tx-1, app-bd-2" },
    ],
    220,
  );
  assert.match(summary, /app-tx-1/);
  assert.ok(summary.length <= 220);
});

test("applications-export uses Asia/Shanghai dates and escapes Markdown links safely", () => {
  const exportLib = loadTs("src/lib/applications-export.ts");
  assert.equal(exportLib.formatExportDate(new Date("2026-10-01T18:00:00.000Z")), "2026-10-02");

  const rows = exportLib.buildApplicationExportRows([
    {
      id: "1",
      title: "后端研发",
      appliedDate: new Date("2026-10-15T00:00:00Z"),
      currentStage: "INTERVIEW_1",
      currentStageDate: new Date("2026-10-20T00:00:00Z"),
      source: "官网投递",
      referrer: "李四",
      salaryMin: 20,
      salaryMax: 30,
      applyUrl: "https://hr.example.com/job(123)?q=a b",
      company: { name: "星辰云", industry: "CLOUD" },
    },
    {
      id: "2",
      title: "产品经理",
      appliedDate: new Date("2026-10-15T00:00:00Z"),
      currentStage: "APPLIED",
      currentStageDate: new Date("2026-10-15T00:00:00Z"),
      applyUrl: "javascript:alert(1)",
      company: { name: "测试厂", industry: "OTHER" },
    },
  ]);

  const md = exportLib.applicationsToMarkdown(rows);
  assert.match(md, /\[打开链接\]\(https:\/\/hr\.example\.com\/job%28123%29\?q=ab\)/);
  assert.doesNotMatch(md, /\[打开链接\]\(javascript:/);
  assert.match(md, /官网投递 · 内推:李四/);
  assert.match(md, /20-30K/);
});

test("webhook helpers detect Feishu/DingTalk/WeCom/generic schemas and surface API errors", async () => {
  let postedBody = null;
  let mockResponse = { ok: true, status: 200, text: async () => JSON.stringify({ StatusCode: 0 }) };
  const webhook = loadTs("src/lib/webhook.ts", {
    "@/lib/app-settings-store": { readAppSettingsFile: async () => ({}) },
    __fetch: async (_url, init) => {
      postedBody = JSON.parse(init.body);
      return mockResponse;
    },
  });

  assert.equal(webhook.validateWebhookUrl("ftp://bad.example.com"), null);
  assert.equal(webhook.validateWebhookUrl("http://169.254.169.254/latest"), null);
  assert.equal(webhook.detectWebhookProvider("https://open.feishu.cn/open-apis/bot/v2/hook/abc"), "feishu");
  assert.equal(webhook.detectWebhookProvider("https://oapi.dingtalk.com/robot/send?access_token=xyz"), "dingtalk");
  assert.equal(webhook.detectWebhookProvider("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1"), "wecom");
  assert.equal(webhook.detectWebhookProvider("https://hooks.example.com/notify"), "generic");

  const feishuRes = await webhook.sendWebhookNotification("https://open.feishu.cn/open-apis/bot/v2/hook/abc", {
    event: "interview_reminder",
    title: "一面提醒",
    body: "今晚 19:00",
    items: ["腾讯 · 后端开发"],
  });
  assert.equal(feishuRes.ok, true);
  assert.equal(feishuRes.provider, "feishu");
  assert.equal(postedBody.msg_type, "text");
  assert.match(postedBody.content.text, /腾讯 · 后端开发/);

  mockResponse = { ok: true, status: 200, text: async () => JSON.stringify({ errcode: 310000, errmsg: "keywords not matched" }) };
  const dingRes = await webhook.sendWebhookNotification("https://oapi.dingtalk.com/robot/send?access_token=xyz", {
    event: "test",
    title: "测试",
    body: "测试内容",
  });
  assert.equal(dingRes.ok, false);
  assert.equal(dingRes.provider, "dingtalk");
  assert.match(dingRes.error, /keywords not matched/);
});

test("updater Mac DMG asset lookup prefers arm64 then universal, and x64 checks x64 DMG cleanly", async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  const handlers = new Map();
  const networkSession = {
    setProxy: async () => {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v1.68.0",
        draft: false,
        prerelease: false,
        assets: [
          { name: "JobCompass-1.68.0-mac-universal.dmg", size: 2048, digest: `sha256:${"a".repeat(64)}`, browser_download_url: "https://github.com/yihongchen772-alt/careerplatform-local/releases/download/v1.68.0/JobCompass-1.68.0-mac-universal.dmg" },
          { name: "JobCompass-1.68.0-mac-arm64.dmg", size: 4096, digest: `sha256:${"b".repeat(64)}`, browser_download_url: "https://github.com/yihongchen772-alt/careerplatform-local/releases/download/v1.68.0/JobCompass-1.68.0-mac-arm64.dmg" },
        ],
      }),
    }),
  };
  const contents = { mainFrame: { url: "http://localhost:3210" }, getURL: () => "http://localhost:3210", isDestroyed: () => false, send() {} };
  const window = { webContents: contents, isDestroyed: () => false };

  const armController = setupUpdater(
    { app: { isPackaged: true, getVersion: () => "1.67.0" }, ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) }, getMainWindow: () => window, beforeInstall: async () => {} },
    { platform: "darwin", arch: "arm64", autoUpdater: updater, networkSession, openExternal: async () => {} },
  );
  assert.equal(typeof armController.check, "function");
  const state = await armController.check();
  assert.equal(state.status, "available");
  assert.equal(state.availableVersion, "1.68.0");
  armController.dispose();

  const x64Controller = setupUpdater(
    { app: { isPackaged: true, getVersion: () => "1.67.0" }, ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) }, getMainWindow: () => window, beforeInstall: async () => {} },
    { platform: "darwin", arch: "x64", autoUpdater: updater, networkSession, openExternal: async () => {} },
  );
  const x64State = await x64Controller.check();
  assert.equal(x64State.mode, "check-only");
  assert.equal(x64State.status, "available");
  x64Controller.dispose();
  void CHANNELS;
});

test("electron render-bridge and browser-view ignore non-mainframe or -3 aborted did-fail-load events", () => {
  const renderBridge = fs.readFileSync(path.resolve(__dirname, "../electron/render-bridge.js"), "utf8");
  const browserView = fs.readFileSync(path.resolve(__dirname, "../electron/browser-view.js"), "utf8");
  assert.match(renderBridge, /if\s*\(!isMainFrame\s*\|\|\s*code\s*===\s*-3\)\s*return;/);
  assert.match(browserView, /if\s*\(!isMainFrame\s*\|\|\s*code\s*===\s*-3\)\s*return;/);
});
