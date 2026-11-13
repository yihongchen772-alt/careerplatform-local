const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTsModule(relPath, extraRequires = {}) {
  const fullPath = path.join(__dirname, "..", relPath);
  const source = fs.readFileSync(fullPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const fn = new Function("require", "module", "exports", "__filename", "__dirname", outputText);
  fn(
    (id) => {
      if (id in extraRequires) return extraRequires[id];
      if (id.startsWith("@/")) return loadTsModule(id.replace(/^@\//, "src/") + ".ts", extraRequires);
      return require(id);
    },
    mod,
    mod.exports,
    fullPath,
    path.dirname(fullPath)
  );
  return mod.exports;
}

const attachmentRoles = loadTsModule("src/lib/attachment-roles.ts");
const postingMatch = loadTsModule("src/lib/posting-match.ts");
const campusQuery = loadTsModule("src/lib/campus-postings-query.ts", {
  "@/lib/campus-sheet": { cohortLabel: (y) => (y ? `${y}届` : null) },
});

test("v66 attachment roles classify proof documents accurately and skip exam/interview study notes", () => {
  assert.equal(attachmentRoles.inferAttachmentRole("证件照", "avatar.jpg"), "photo");
  assert.equal(attachmentRoles.inferAttachmentRole("成绩单", "本科成绩.pdf"), "transcript");
  assert.equal(attachmentRoles.inferAttachmentRole("英语证书", "CET6.pdf"), "language");
  assert.equal(attachmentRoles.inferAttachmentRole("证书", "大学英语六级成绩单.pdf"), "language");
  assert.equal(attachmentRoles.inferAttachmentRole("证书", "蓝桥杯国二.pdf"), "certificate");
  assert.equal(attachmentRoles.inferAttachmentRole("作品集", "作品.pdf"), "portfolio");
  assert.equal(attachmentRoles.inferAttachmentRole("在读证明", "学籍验证.pdf"), "enrollment");
  assert.equal(attachmentRoles.inferAttachmentRole("笔试资料", "行测刷题.pdf"), null);
  assert.equal(attachmentRoles.inferAttachmentRole("面试资料", "八股文.pdf"), null);
});

test("v66 friendlyAttachmentUploadName formats HR-facing filenames cleanly", () => {
  assert.equal(attachmentRoles.friendlyAttachmentUploadName("张伟", "photo", ".jpg"), "张伟-证件照.jpg");
  assert.equal(attachmentRoles.friendlyAttachmentUploadName("我", "transcript", "pdf"), "成绩单.pdf");
  assert.equal(attachmentRoles.friendlyAttachmentUploadName("李明/敏", "portfolio", ".pdf"), "李明敏-作品集.pdf");
});

test("v66 resolveAutofillAttachments keeps newest library proof file per role and ignores application-only attachments", () => {
  const now = Date.now();
  const rows = [
    { id: "old-photo", name: "老照片.jpg", url: "/api/files/old.jpg", category: "证件照", createdAt: new Date(now - 5000) },
    { id: "new-photo", name: "一寸免冠.png", url: "/api/files/new.png", category: "证件照", createdAt: new Date(now - 1000) },
    { id: "study-note", name: "面经总结.pdf", url: "/api/files/note.pdf", category: "面试资料", createdAt: new Date(now) },
    { id: "app-only", name: "成绩单.pdf", url: "/api/files/app.pdf", category: null, createdAt: new Date(now) },
    { id: "transcript", name: "教务处成绩单.pdf", url: "/api/files/tr.pdf", category: "成绩单", createdAt: new Date(now - 2000) },
  ];
  const resolved = attachmentRoles.resolveAutofillAttachments(rows, "张伟");
  assert.equal(resolved.length, 2);
  assert.equal(resolved.find((r) => r.role === "photo")?.id, "new-photo");
  assert.equal(resolved.find((r) => r.role === "photo")?.uploadName, "张伟-证件照.png");
  assert.equal(resolved.find((r) => r.role === "transcript")?.uploadName, "张伟-成绩单.pdf");
});

test("v66 autofill-core marks typed proof file inputs distinctly from resume inputs", () => {
  const coreSrc = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  assert.doesNotMatch(coreSrc, /\brequire\(/);

  const attrs = (initial) => {
    const map = new Map(Object.entries(initial || {}));
    return {
      disabled: false,
      files: null,
      name: map.get("name") || "",
      id: map.get("id") || "",
      getAttribute: (k) => map.get(k) ?? null,
      setAttribute: (k, v) => map.set(k, v),
      removeAttribute: (k) => map.delete(k),
      closest: () => ({ textContent: map.get("nearbyText") || "", querySelector: () => null }),
    };
  };

  const fakeInputs = [
    attrs({ id: "resume", nearbyText: "请上传个人简历 PDF" }),
    attrs({ id: "avatar", accept: "image/jpeg,image/png", nearbyText: "一寸证件照" }),
    attrs({ id: "score", nearbyText: "本科成绩单扫描件" }),
    attrs({ id: "cet6", nearbyText: "四六级/英语证书上传" }),
    attrs({ id: "work", nearbyText: "设计/研发作品集附件" }),
  ];

  const sandbox = {
    document: {
      querySelectorAll: (sel) => (sel === 'input[type="file"]' ? fakeInputs : []),
      querySelector: () => null,
    },
    CSS: { escape: (s) => s },
    module: { exports: {} },
  };
  vm.runInNewContext(coreSrc, sandbox);
  const core = sandbox.module.exports;

  assert.equal(core.AUTOFILL_MODULES.includes("attachment"), true);
  assert.equal(core.markResumeFileInputs(), 1);
  assert.equal(fakeInputs[0].getAttribute("data-cp-resume-upload"), "1");

  const roles = core.markTypedFileInputs(["photo", "transcript", "language", "portfolio"]);
  assert.deepEqual([...roles].sort(), ["language", "photo", "portfolio", "transcript"]);
  assert.equal(fakeInputs[0].getAttribute("data-cp-upload-role"), null);
  assert.equal(fakeInputs[1].getAttribute("data-cp-upload-role"), "photo");
  assert.equal(fakeInputs[2].getAttribute("data-cp-upload-role"), "transcript");
  assert.equal(fakeInputs[3].getAttribute("data-cp-upload-role"), "language");
  assert.equal(fakeInputs[4].getAttribute("data-cp-upload-role"), "portfolio");
});

test("v66 posting-match expands synonyms and ranks matching postings accurately", () => {
  const signal = postingMatch.extractProfileSignal(
    { targetTrack: "嵌入式开发", preferredCities: "深圳、上海", skills: "FreeRTOS STM32", graduationYear: 2027 },
    "熟悉 Linux 驱动与 C语言编程"
  );
  assert.equal(signal.hasSignal, true);

  const great = postingMatch.scorePostingMatch(
    { companyName: "大疆", title: "嵌入式软件工程师", tracks: "嵌入式 MCU驱动", cities: "深圳", graduation: "2027届" },
    signal
  );
  const weak = postingMatch.scorePostingMatch(
    { companyName: "某地产", title: "财务管培生", tracks: "会计 审计", cities: "哈尔滨", graduation: "2025届" },
    signal
  );
  assert.equal(great.tier, "high");
  assert.ok(great.score >= 80, `Expected great score >= 80, got ${great.score}`);
  assert.ok(great.reasons.some((r) => r.includes("城市:深圳")));
  assert.ok(weak.score < 25, `Expected weak score < 25, got ${weak.score}`);
});

test("v66 campus-postings-query preserves match sort option cleanly", () => {
  const filters = campusQuery.readPostingFilters({ sort: "match", q: "嵌入式", page: "2" });
  assert.equal(filters.sort, "match");
  assert.equal(filters.q, "嵌入式");
  assert.equal(filters.page, 2);
  assert.equal(campusQuery.postingsHref(filters, {}), "/leads?view=postings&q=%E5%B5%8C%E5%85%A5%E5%BC%8F&sort=match");
});

test("v66 batch queue and cram brief wiring exist without auto-submitting third-party forms", () => {
  const bvSrc = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
  const preloadSrc = fs.readFileSync(path.join(__dirname, "../electron/preload.js"), "utf8");
  const scheduleSrc = fs.readFileSync(path.join(__dirname, "../src/components/schedule/upcoming-schedule.tsx"), "utf8");
  const leadsSrc = fs.readFileSync(path.join(__dirname, "../src/app/(dashboard)/leads/page.tsx"), "utf8");

  assert.match(bvSrc, /browser:open-batch/);
  assert.match(bvSrc, /browser:fill-all-pending/);
  assert.match(bvSrc, /uploadTypedFiles/);
  assert.match(preloadSrc, /openBatch:\s*\(/);
  assert.match(scheduleSrc, /考前抱佛脚/);
  assert.match(scheduleSrc, /BriefCramDialog/);
  assert.match(leadsSrc, /DiscoverJobsPanel/);
  assert.match(leadsSrc, /全网实时搜岗/);
});
