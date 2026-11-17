const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relPath, mocks = {}) {
  const fullPath = path.join(__dirname, "..", relPath);
  const src = fs.readFileSync(fullPath, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  });
  const mod = { exports: {} };
  const requireFn = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith("@/")) {
      return loadTs(`src/${specifier.slice(2)}.ts`, mocks);
    }
    return require(specifier);
  };
  vm.runInNewContext(
    outputText,
    {
      module: mod,
      exports: mod.exports,
      require: requireFn,
      console,
      URL,
      Set,
      Map,
    },
    { filename: fullPath }
  );
  return mod.exports;
}

test("UX v69: selectPrimaryInfobar arbitrates priority and collapses stacked browser notices", () => {
  const { selectPrimaryInfobar } = loadTs("src/lib/browser-infobar-queue.ts");

  const norm = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(norm(selectPrimaryInfobar([])), { activeId: null, queuedIds: [], queuedCount: 0 });

  const multi = selectPrimaryInfobar([
    "detectedForm",
    "autofillDone",
    "setupRecommendation",
    "eligibilityWarning",
    "otpPrompt",
    "otpPrompt",
  ]);
  assert.equal(multi.activeId, "otpPrompt");
  assert.equal(multi.queuedCount, 4);
  assert.deepEqual(norm(multi.queuedIds), ["eligibilityWarning", "setupRecommendation", "autofillDone", "detectedForm"]);

  const busy = selectPrimaryInfobar(["recordedBar", "autofillBusy", "pageProblem"]);
  assert.equal(busy.activeId, "pageProblem");
  assert.equal(busy.queuedCount, 2);
});

test("UX v69: lifecycle IA clusters, categorized tools, collapsible sidebar, and streamlined dashboard", () => {
  const modTabsSrc = fs.readFileSync(path.join(__dirname, "..", "src/components/layout/module-tabs.tsx"), "utf8");
  for (const href of [
    "/leads",
    "/companies",
    "/pool",
    "/browser",
    "/applications",
    "/compare",
    "/insights",
    "/mock-interview",
    "/resume-drill",
    "/interviews",
    "/question-banks",
    "/resumes",
    "/library",
  ]) {
    assert.ok(modTabsSrc.includes(href), `ModuleTabs should include ${href}`);
  }

  const navToolsSrc = fs.readFileSync(path.join(__dirname, "..", "src/lib/nav-tools.ts"), "utf8");
  assert.match(navToolsSrc, /group: "面试备考"/);
  assert.match(navToolsSrc, /group: "企查与决策"/);
  assert.match(navToolsSrc, /group: "材料与记录"/);

  const toolsPageSrc = fs.readFileSync(path.join(__dirname, "..", "src/app/(dashboard)/tools/page.tsx"), "utf8");
  assert.match(toolsPageSrc, /TOOL_LINKS\.filter\(\(item\) => item\.group === group\.id\)/);

  const navSrc = fs.readFileSync(path.join(__dirname, "..", "src/components/dashboard/nav.tsx"), "utf8");
  assert.match(navSrc, /careerplatform\.sidebar\.collapsed/);
  assert.match(navSrc, /cp:sidebar-toggle/);

  const dashSrc = fs.readFileSync(path.join(__dirname, "..", "src/app/(dashboard)/dashboard/page.tsx"), "utf8");
  assert.doesNotMatch(dashSrc, /<FunnelCard/);
  assert.match(dashSrc, /阶段转化概览/);

  const settingsSrc = fs.readFileSync(path.join(__dirname, "..", "src/app/(dashboard)/settings/page.tsx"), "utf8");
  assert.match(settingsSrc, /求职与网申资料/);
  assert.match(settingsSrc, /系统与自动化/);
});

test("UX v69: embedded-browser queue, dark container, shortcuts, and new-tab drafts", () => {
  const ebSrc = fs.readFileSync(path.join(__dirname, "..", "src/components/browser/embedded-browser.tsx"), "utf8");
  assert.match(ebSrc, /selectPrimaryInfobar/);
  assert.match(ebSrc, /展开其余 \$\{queuedCount\} 条/);
  assert.match(ebSrc, /导出与排查工具/);
  assert.match(ebSrc, /cp:sidebar-toggle/);
  assert.match(ebSrc, /bg-card/);

  const bvSrc = fs.readFileSync(path.join(__dirname, "..", "electron/browser-view.js"), "utf8");
  assert.match(bvSrc, /\^\[1-9\]\$/);
  assert.match(bvSrc, /"autofill" : "toggle-assistant"/);

  const ntpSrc = fs.readFileSync(path.join(__dirname, "..", "src/components/browser/new-tab-page.tsx"), "utf8");
  assert.match(ntpSrc, /application-draft/);
  assert.match(ntpSrc, /未提交的填写草稿/);
  assert.match(ntpSrc, /"全部", "进度页", "候选岗位", "企业官网"/);
});
