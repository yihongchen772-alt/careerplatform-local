const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// TS modules without runtime deps beyond zod: transpile and evaluate them.
function loadTs(relative, extraRequire = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: (name) => extraRequire[name] ?? require(name), URL, Buffer, process }, { filename: relative });
  return mod.exports;
}

const { siteKey, looksLikeCandidateCenter } = loadTs("src/lib/site-key.ts");
const { sanitizeResumeBody, renderTailoredResumeBody, tailoredResumeSchema } = loadTs("src/lib/tailored-resume.ts");
const { resolveProfileVariant, parseApplicationProfile } = loadTs("src/lib/application-profile.ts");

test("site keys group one employer's domains and split tenants on shared ATS hosts", () => {
  assert.equal(siteKey("https://join.tencent.com/apply"), siteKey("https://careers.tencent.com/home"));
  assert.equal(siteKey("https://campus.alibaba.com.cn/x"), "alibaba.com.cn");
  assert.equal(siteKey("https://app.mokahr.com/social-recruitment/jingweihengrun/168299#/job/1"), "mokahr.com/jingweihengrun");
  assert.equal(siteKey("https://app.mokahr.com/campus-recruitment/jingweihengrun/1#/candidateHome"), "mokahr.com/jingweihengrun");
  assert.notEqual(siteKey("https://app.mokahr.com/apply/acme/1"), siteKey("https://app.mokahr.com/apply/other/1"));
  assert.equal(siteKey("https://acme.zhiye.com/campus"), "acme.zhiye.com");
  assert.notEqual(siteKey("https://acme.jobs.feishu.cn/index"), siteKey("https://other.jobs.feishu.cn/index"));
  assert.equal(siteKey("https://wecruit.hotjob.cn/SU61234/pb/index.html"), "hotjob.cn/su61234");
  for (const board of ["https://www.zhipin.com/job/1", "https://www.nowcoder.com/jobs", "https://www.bing.com/search?q=x", "file:///tmp/a", "not a url", null]) {
    assert.equal(siteKey(board), null, String(board));
  }
});

test("candidate-center pages are recognised, ordinary pages with a nav link are not", () => {
  assert.equal(looksLikeCandidateCenter("https://x.com/#/candidateHome", "个人中心", "我的投递\n投递进度：简历筛选"), true);
  assert.equal(looksLikeCandidateCenter("https://x.com/personal/apply", "申请记录", "职位 状态"), true);
  assert.equal(looksLikeCandidateCenter("https://x.com/jobs/123", "数据分析师", "职位描述……\n我的投递"), false);
  assert.equal(looksLikeCandidateCenter("https://x.com/jobs/123", "数据分析师", "岗位职责……"), false);
});

test("profile variants swap experiences/projects/extras but share education", () => {
  const profile = parseApplicationProfile({
    education: [{ school: "东南大学", degree: "本科" }],
    projects: [{ name: "默认项目" }],
    extras: { english: "CET-6", currentCity: "上海" },
    variants: [{ id: "data", name: "数据方向", resumeVersionId: "r-data", projects: [{ name: "数据项目" }], experiences: [], extras: { currentCity: "北京" } }],
  });
  assert.equal(resolveProfileVariant(profile).profile.projects[0].name, "默认项目");
  const byId = resolveProfileVariant(profile, "data");
  assert.equal(byId.variant.name, "数据方向");
  assert.equal(byId.profile.projects[0].name, "数据项目");
  assert.equal(byId.profile.education[0].school, "东南大学");
  assert.equal(byId.profile.extras.currentCity, "北京");
  assert.equal(byId.profile.extras.english, "CET-6");
  assert.equal(resolveProfileVariant(profile, null, "r-data").variant.id, "data");
  // An explicit "default" choice ignores the resume link.
  assert.equal(resolveProfileVariant(profile, "default", "r-data").variant, null);
  assert.equal(parseApplicationProfile({ education: [], experiences: [], projects: [], extras: {} }).variants.length, 0);
});

test("tailored resume escapes AI text and edits cannot smuggle active content", () => {
  const doc = tailoredResumeSchema.parse({ headline: "数据<script>", summary: "a & b", experiences: [{ title: "字节", subtitle: "实习", bullets: ["<img src=x onerror=alert(1)>"] }] });
  const body = renderTailoredResumeBody(doc, { name: "测试", phone: "1", email: "e", city: "" }, [{ school: "东南大学", major: "测控", degree: "本科", gpa: "", start: "2020-09", end: "2024年6月" }]);
  assert.doesNotMatch(body, /<script|<img/);
  assert.match(body, /数据&lt;script&gt;/);
  assert.match(body, /东南大学/);
  assert.match(body, /2020\.09 – 2024\.06/);
  const dirty = '<h1 onclick="x()">名</h1><script>alert(1)</script><img src=x onerror=y><a href="javascript:z">链接</a><p style="background:url(x)">正文</p><iframe src="https://e"></iframe>';
  const clean = sanitizeResumeBody(dirty);
  assert.doesNotMatch(clean, /onclick|<script|<img|javascript:|<iframe|style=/);
  assert.match(clean, /<h1>名<\/h1>/);
  assert.match(clean, /正文/);
});

test("auto backup keeps the newest N and reads WebDAV listings", async () => {
  const autoBackup = loadTs("src/lib/auto-backup.ts", {
    "@/lib/db": { db: {} },
    "@/lib/session": { LOCAL_USER_ID: "local-user" },
    "@/lib/crypto": { decryptSecret: (s) => s },
    "@/lib/backup-core": { buildBackupPayload: async () => ({ payload: "{}", files: 0 }) },
  });
  const names = ["求职罗盘自动备份-2026-09-01-10-00-00.json", "求职罗盘自动备份-2026-09-03-10-00-00.json", "求职罗盘自动备份-2026-09-02-10-00-00.json", "别的文件.json", "求职罗盘备份-2026-09-01.json"];
  assert.deepEqual([...autoBackup.backupsToPrune(names, 2)], ["求职罗盘自动备份-2026-09-01-10-00-00.json"]);
  assert.equal(autoBackup.backupsToPrune(names, 0).length, 2, "always keeps at least one");
  const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/%E6%B1%82%E8%81%8C/</d:href></d:response><d:response><d:href>/dav/%E6%B1%82%E8%81%8C/${encodeURIComponent(names[0])}</d:href></d:response><D:response><D:href>/dav/x/a.json</D:href></D:response></d:multistatus>`;
  assert.deepEqual([...autoBackup.parsePropfindNames(xml)], ["求职", names[0], "a.json"]);
});
