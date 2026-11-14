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

test("zhiye provider parses Beisen JSON and SSR HTML job links cleanly", async () => {
  const zhiye = await import("../electron/career-ops/providers/zhiye.mjs");
  assert.equal(zhiye.resolveZhiyeOrigin("https://campus.zhiye.com/jobs"), "https://campus.zhiye.com");
  assert.equal(zhiye.resolveZhiyeOrigin("https://www.zhiye.com"), null);
  assert.equal(zhiye.resolveZhiyeOrigin("http://campus.zhiye.com"), null);

  const parsed = zhiye.parseZhiyeResponse(
    {
      Data: {
        TotalCount: 2,
        List: [
          {
            Id: "99001",
            JobAdName: "2027届C++服务端研发实习生",
            LocNames: ["上海市", "北京市"],
            CategoryName: "研发类",
            Duty: "<p>负责核心网关高性能改造</p>",
          },
        ],
      },
    },
    "示例科技",
    "https://campus.zhiye.com",
  );
  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0].title, "2027届C++服务端研发实习生");
  assert.equal(parsed.jobs[0].url, "https://campus.zhiye.com/jobs/detail/99001");
  assert.equal(parsed.jobs[0].location, "上海市/北京市");
  assert.match(parsed.jobs[0].description, /负责核心网关高性能改造/);

  const htmlJobs = zhiye.parseZhiyeHtml(
    '<div><a href="/jobs/detail/202788">大模型推理优化工程师</a></div>',
    "示例科技",
    "https://campus.zhiye.com",
  );
  assert.equal(htmlJobs.length, 1);
  assert.equal(htmlJobs[0].url, "https://campus.zhiye.com/jobs/detail/202788");
});

test("builtin-feed reads gzipped cloud mirror and falls back to local career-ops boards", async () => {
  const zlib = require("node:zlib");
  const samplePayload = {
    version: 1,
    rev: 1763150000,
    generatedAt: "2026-11-15T00:00:00.000Z",
    total: 1,
    items: [
      {
        externalId: "feed:12345",
        company: "字节跳动",
        roles: "2027届大模型算法实习生",
        cohort: "2027届",
        kind: "实习",
        cities: "北京、上海",
        industry: "互联网/AI",
        degree: "硕士及以上",
        writtenTest: null,
        applyUrl: "https://jobs.bytedance.com/experienced/position/12345/detail",
        noticeUrl: null,
        startDate: "2026-11-14",
        deadline: null,
        deadlineText: "招满即止",
        note: "负责大模型 RLHF 与 Agent 训练",
        salary: null,
      },
    ],
  };
  const gzBytes = zlib.gzipSync(Buffer.from(JSON.stringify(samplePayload), "utf8"));

  let failCloud = false;
  const feedLib = loadTs("src/lib/builtin-feed.ts", {
    "@/lib/proxy-agent": { applyProxy: async () => {} },
    "@/lib/career-ops": {
      BUILT_IN_BOARDS: [{ name: "DeepSeek校招", careers_url: "https://app.mokahr.com/campus-recruitment/high-flyer/140575", industry: "AI大模型/量化" }],
      runBoards: async () => [
        {
          name: "DeepSeek校招",
          provider: "mokahr",
          jobs: [
            {
              title: "2027届深度学习研究员（校招）",
              url: "https://app.mokahr.com/campus-recruitment/high-flyer/140575#/job/abc",
              location: "中国-北京市/杭州市",
              company: "DeepSeek校招",
              postedAt: Date.parse("2026-11-10T00:00:00Z"),
              description: "要求硕士及以上学历，研究大模型架构",
            },
          ],
        },
      ],
    },
    __fetch: async (url) => {
      if (failCloud) throw new Error("network down");
      if (String(url).endsWith("postings-feed-meta.json")) {
        return { ok: true, json: async () => ({ rev: 1763150000 }) };
      }
      return {
        ok: true,
        arrayBuffer: async () => gzBytes.buffer.slice(gzBytes.byteOffset, gzBytes.byteOffset + gzBytes.byteLength),
      };
    },
  });

  assert.equal(feedLib.isBuiltinFeedUrl("builtin://official-feed"), true);
  assert.equal(feedLib.isBuiltinFeedUrl("https://xxx.feishu.cn/base/abc"), false);
  assert.equal(await feedLib.builtinFeedRevision(), 1763150000);

  const cloudResult = await feedLib.readBuiltinFeed(new Date("2026-11-15T00:00:00Z"));
  assert.equal(cloudResult.mode, "cloud");
  assert.equal(cloudResult.rev, 1763150000);
  assert.equal(cloudResult.postings.length, 1);
  assert.equal(cloudResult.postings[0].company, "字节跳动");
  assert.equal(cloudResult.postings[0].kind, "实习");

  failCloud = true;
  const localResult = await feedLib.readBuiltinFeed(new Date("2026-11-15T00:00:00Z"));
  assert.equal(localResult.mode, "local");
  assert.equal(localResult.postings.length, 1);
  assert.equal(localResult.postings[0].company, "DeepSeek");
  assert.equal(localResult.postings[0].cohort, "2027届");
  assert.equal(localResult.postings[0].kind, "秋招");
  assert.equal(localResult.postings[0].cities, "北京、杭州");
  assert.equal(localResult.postings[0].degree, "硕士及以上");

  // Overseas-only and third-party outsourcing jobs are filtered out
  assert.equal(
    feedLib.boardJobToPostingFields({
      title: "Backend Engineer",
      url: "https://jobs.bytedance.com/experienced/position/999/detail",
      location: "新加坡/东京",
      company: "字节跳动",
      postedAt: null,
      description: "Overseas role",
    }),
    null
  );
  assert.equal(
    feedLib.boardJobToPostingFields({
      title: "Sourcer (Third-party Associate)",
      url: "https://jobs.bytedance.com/experienced/position/998/detail",
      location: "上海",
      company: "字节跳动",
      postedAt: null,
      description: "类型: 第三方派遣",
    }),
    null
  );
});

test("v1.69.1: browser:open-url reuses existing tab without refreshing and opens new tab when another page is open", async () => {
  const { pathToFileURL } = require("node:url");
  const bvSrc = fs.readFileSync(path.resolve(__dirname, "../electron/browser-view.js"), "utf8");
  const ebSrc = fs.readFileSync(path.resolve(__dirname, "../src/components/browser/embedded-browser.tsx"), "utf8");
  assert.match(bvSrc, /handle\("browser:open-url"/);
  assert.match(bvSrc, /return \{ tabId: existing\.id, reused: true \}/);
  assert.match(ebSrc, /bridge\.openUrl\(initialUrl/);

  const tencentMod = await import(pathToFileURL(path.resolve(__dirname, "../electron/career-ops/providers/tencent.mjs")).href);
  const qqParsed = tencentMod.parseTencentCampusResponse(
    {
      data: {
        count: 1,
        positionList: [
          {
            postId: "1282707398326592512",
            positionTitle: "AI全栈工程师",
            workCities: "深圳总部 北京 上海 ",
            bgs: "TEG WXG",
            recruitLabelName: "应届毕业生",
          },
        ],
      },
    },
    "腾讯校招"
  );
  assert.equal(qqParsed.jobs.length, 1);
  assert.equal(qqParsed.jobs[0].url, "https://join.qq.com/post_detail.html?postid=1282707398326592512");
  assert.equal(qqParsed.jobs[0].location, "深圳/北京/上海");
  assert.match(qqParsed.jobs[0].description, /校园招聘（应届毕业生）/);
});

test("v1.69.2: Apple/iOS UI styles, distinct light/dark palettes, and sidebar QuickThemeSwitcher", () => {
  const themeLib = loadTs("src/lib/theme.ts");
  assert.equal(themeLib.STYLES.length, 4);
  assert.equal(themeLib.PALETTES.length, 6);

  const css = fs.readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
  // Dark palettes keep their distinct identities instead of being flattened by a global :root.dark[data-palette] override
  assert.equal(css.includes(":root.dark[data-palette]"), false);
  assert.match(css, /\.dark\[data-palette="tech"\]/);
  assert.match(css, /\.dark\[data-palette="aurora"\]/);
  assert.match(css, /\.dark\[data-palette="champagne"\]/);
  assert.match(css, /\[data-style="glass"\] \.app-sidebar/);

  const navSrc = fs.readFileSync(path.resolve(__dirname, "../src/components/dashboard/nav.tsx"), "utf8");
  assert.match(navSrc, /QuickThemeSwitcher/);
  assert.match(navSrc, /nav-item-chip/);
});

test("v1.69.3: BUILT_IN_BOARDS focuses exclusively on Moka, Beisen (zhiye.com), and Feishu ATS boards", () => {
  const careerOps = loadTs("src/lib/career-ops.ts", {
    "@/lib/db": { prisma: {} },
    "@/lib/proxy-agent": { applyProxy: async () => {} },
  });
  assert.ok(careerOps.BUILT_IN_BOARDS.length >= 20);
  for (const board of careerOps.BUILT_IN_BOARDS) {
    const host = new URL(board.careers_url).hostname.toLowerCase();
    const isStandardThree =
      host === "app.mokahr.com" ||
      host.endsWith(".zhiye.com") ||
      host.endsWith(".jobs.feishu.cn") ||
      host === "jobs.bytedance.com";
    assert.equal(isStandardThree, true, `Unexpected host ${host} in BUILT_IN_BOARDS for ${board.name}`);
  }
});

test("v1.69.4: background batch prefill survives tab switch, extension per-item queue options & stop, DMG backup order, and robotics/degree match scoring", () => {
  const bvSrc = fs.readFileSync(path.resolve(__dirname, "../electron/browser-view.js"), "utf8");
  assert.match(bvSrc, /if \(!force && task\.allowBackground\) return;/);
  assert.match(bvSrc, /tab\.resumeVersionId\s*:\s*resolvedResumeId|const resolvedResumeId/);

  const extBg = fs.readFileSync(path.resolve(__dirname, "../extension/background.js"), "utf8");
  assert.match(extBg, /nextItem\.options\s*\?/);
  assert.match(extBg, /async batchStop\(\)/);

  const updaterSrc = fs.readFileSync(path.resolve(__dirname, "../electron/updater.js"), "utf8");
  const installSection = updaterSrc.slice(updaterSrc.indexOf("async function install()"));
  assert.ok(installSection.indexOf("await beforeInstall()") < installSection.indexOf("await openPath(dmgFile)"));

  const coreSrc = fs.readFileSync(path.resolve(__dirname, "../electron/autofill-core.js"), "utf8");
  assert.match(coreSrc, /\.n-base-selection-input__content/);
  assert.match(coreSrc, /prefers-color-scheme:\s*dark/);
  assert.match(coreSrc, /el\.shadowRoot \|\| el/);

  const postingMatch = loadTs("src/lib/posting-match.ts");
  const sig = postingMatch.extractProfileSignal(
    { targetTrack: "具身智能 运动控制", preferredCities: "上海", graduationYear: 2027, degree: "硕士" },
    "熟练使用 C++ / ROS2 / Simulink / MPC 算法"
  );
  assert.ok(sig.skillTerms.includes("ros2") || sig.trackTerms.includes("ros2"));
  const masterMatch = postingMatch.scorePostingMatch(
    { companyName: "智元机器人", title: "运动控制算法工程师", cities: "上海", graduation: "2027届", degree: "硕士及以上" },
    sig
  );
  const phdOnly = postingMatch.scorePostingMatch(
    { companyName: "某研究院", title: "运动控制算法工程师", cities: "上海", graduation: "2027届", degree: "博士" },
    sig
  );
  assert.ok(masterMatch.score > phdOnly.score, `Expected master match (${masterMatch.score}) > phd-only (${phdOnly.score})`);
});
