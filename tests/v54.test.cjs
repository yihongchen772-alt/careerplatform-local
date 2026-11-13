const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function loadTs(relative) {
  const compiled = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const local = (name) => (name.startsWith("@/") ? loadTs(`src/${name.slice(2)}.ts`) : require(name));
  vm.runInThisContext(`(function (module, exports, require) {${compiled}\n})`, { filename: relative })(mod, mod.exports, local);
  return mod.exports;
}

const { identifyApplication } = loadTs("src/lib/application-identity.ts");

// A made-up 网申: generic page titles, a success page that names nothing.
const jdText = ["首页 · 校园招聘 · 社会招聘", "机器人测试工程师", "示例科技 · 2027 届校招", "工作地点：上海", "岗位职责", "负责整机测试；", "任职要求", "熟悉 Python。"].join("\n");
const base = {
  url: "https://jobs.example-tech.cn/done",
  title: "投递结果",
  text: "投递成功！我们会尽快与你联系。",
  siteName: null,
  history: [{ url: "https://jobs.example-tech.cn/position/9", title: "校园招聘" }, { url: "https://jobs.example-tech.cn/apply/9", title: "校园招聘" }],
  fields: [],
};

test("the JD page names the job and employer when the pages' titles and the success page don't", () => {
  const blind = identifyApplication(base, [], []);
  assert.equal(blind.title, "");
  const found = identifyApplication({ ...base, jdText }, [], []);
  assert.equal(found.title, "机器人测试工程师");
  assert.equal(found.companyName, "示例科技");
  assert.ok(found.evidence.includes("岗位页面的文字"));
});

test("the form as sent still comes first; a JD with no job line adds nothing", () => {
  const fromForm = identifyApplication({ ...base, jdText, fields: [{ label: "应聘岗位", value: "嵌入式软件工程师" }] }, [], []);
  assert.equal(fromForm.title, "嵌入式软件工程师");
  const vague = identifyApplication({ ...base, jdText: "欢迎加入我们\n岗位职责\n负责测试\n任职要求\n本科" }, [], []);
  assert.equal(vague.title, "");
});

test("the form is read when it is sent — hand-filled too — and never a login or private field", () => {
  const preload = read("electron/browser-guest-preload.js");
  assert.match(preload, /reportSentForm\(event\.target, label\)/);
  assert.match(preload, /SEND_TEXT = \/提\\s\*交\|投\\s\*递\|申\\s\*请/);
  assert.match(preload, /type === "password" && shown\(el\)\) return null/, "a visible password box means a login, not a 网申");
  assert.match(preload, /PRIVATE_LABEL\.test\(label\) \|\| \/\\d\{17\}\[\\dXx\]\/\.test\(value\)/);
  assert.match(preload, /ipcRenderer\.send\("browser-guest:form-sent", \{ fields, final \}\)/);
  assert.match(read("electron/browser-view.js"), /if \(fields\.length < 3\) return;/, "a search box or a filter is not a form worth remembering");
});

test("on the 投递成功 page the sent steps are merged into the snapshot, and dropped once recorded", () => {
  const view = read("electron/browser-view.js");
  assert.match(view, /ipcMain\.on\("browser-guest:form-sent"/);
  assert.match(view, /if \(!fields\.length\) \{\r?\n\s+const steps = \[\];/);
  assert.match(view, /hostOf\(step\.url\) === hostOf\(newer\.url\) && newer\.at - step\.at < 3600_000/, "only this application's steps");
  assert.match(view, /handle\("browser:application-recorded", \(_e, undone\) => \{/);
  assert.match(view, /tab\.recordedState = \{ sentForms: tab\.sentForms, jdPage: tab\.jdPage, historyMark: tab\.historyMark, positionId: tab\.positionId \};/);
  assert.match(read("electron/preload.js"), /applicationRecorded: \(undone\) => ipcRenderer\.invoke\("browser:application-recorded", !!undone\)/);
  for (const file of ["src/components/browser/mark-applied-from-browser.tsx", "src/components/browser/embedded-browser.tsx"]) assert.match(read(file), /applicationRecorded\?\.\(\)/);
  assert.match(read("src/components/browser/recognize-application.ts"), /jdText: \(snapshot\.jdPage\?\.text \|\| ""\)\.slice\(0, 4000\)/);
  assert.match(read("src/lib/application-identity-ai.ts"), /投递前看的岗位页面（节选）/);
});

test("a resume the App already knows is shown as a line with 换一个, not a choice to make", () => {
  const dialog = read("src/components/browser/mark-applied-from-browser.tsx");
  assert.match(dialog, /resumeReason && !resumePicked && !changingResume \?/);
  assert.match(dialog, />换一个<\/button>/);
});

test("recorded on its own only when all is clear; undo is one click; a switch turns it off", () => {
  const browser = read("src/components/browser/embedded-browser.tsx");
  assert.match(browser, /autoRecord && found\?\.sentAt && Date\.now\(\) - found\.sentAt < 5 \* 60000 && settled\.companyName && settled\.title && !resumeUnsure/);
  assert.match(browser, /已自动记为投递/);
  assert.match(browser, /打开这条投递/);
  assert.match(browser, /async function undoRecorded\(\)/);
  assert.match(browser, /applicationRecorded\?\.\(true\)/, "撤销 brings the form and JD back, to record it again");
  assert.match(browser, /careerplatform\.browser\.autoRecordSubmitted/);
  assert.match(browser, /投递成功后自动记录/);
  assert.match(browser, /recordingTabs\.current\.has\(payload\.tabId\)/);
  const view = read("electron/browser-view.js");
  assert.match(view, /Date\.now\(\) - tab\.recordedAt < 3 \* 60000 && !\(tab\.lastSendAt > tab\.recordedAt\)/, "a toast and then a success page are one 网申; a new send is the next one");
  const action = read("src/lib/actions/submitted-application.ts");
  assert.match(action, /if \(data\.auto && await db\.application\.findFirst\(\{ where: \{ userId: user\.id, companyId, title: data\.title \}/, "a job already on record is not added again on its own");
  assert.match(browser, /这个岗位之前已经记录过/);
});

test("a brief 投递成功 toast right after a real send is caught; 下一步 doesn't count as a send", () => {
  const preload = read("electron/browser-guest-preload.js");
  assert.match(preload, /const STEP_TEXT = \/下一步\|保\\s\*存/);
  assert.match(preload, /new MutationObserver/);
  assert.match(preload, /text\.length <= 300 \? SUCCESS_TEXT\.exec\(text\)/, "a short toast, not a whole page");
  assert.match(preload, /setTimeout\(stopSuccessWatch, 30000\)/);
  assert.match(preload, /reportSentForm\(target, text\)\) watchForSuccess\(text\)/);
  assert.match(preload, /const final = !step && \(STRONG_SEND\.test\(label\) \|\| fields\.length >= 3\)/, "确定 on a cookie box is not a send");
  assert.match(preload, /STEP_TEXT\.test\(label\) && !\/提\\s\*交\|投\\s\*递\/\.test\(label\)/, "保存并提交 does send");
  assert.match(preload, /VAGUE_SUCCESS\.test\(match\[0\]\) && \(!vagueCounts \|\| !ABOUT_A_JOB\.test/, "a bare 提交成功 only after a clear send, on a page about a job");
  const view = read("electron/browser-view.js");
  assert.match(view, /ipcMain\.on\("browser-guest:success-seen"/);
  assert.match(view, /if \(payload\.final === true\) \{\r?\n\s+tab\.lastSendAt = now;\r?\n\s+submittedSignatures\.delete\(tab\.id\);/);
  assert.match(view, /lastSendAt: tab\.lastSendAt \|\| null/);
  const core = read("electron/autofill-core.js");
  assert.match(core, /"成功投递", "申请成功", "报名成功"/);
});

test("quitting with several tabs doesn't throw: gone tabs are skipped", () => {
  const view = read("electron/browser-view.js");
  assert.match(view, /const live = tabs\.filter\(\(t\) => \{ const wc = t\.view\.webContents; return wc && !wc\.isDestroyed\(\); \}\);/);
  assert.match(view, /tabs: live\.map\(tabState\)/);
  assert.match(view, /if \(!wc \|\| wc\.isDestroyed\(\)\) return;\r?\n\s+const page = await wc\.executeJavaScript/);
});

test("answers keep their own questions: merged by step, labels never borrowed across a field", () => {
  const view = read("electron/browser-view.js");
  assert.match(view, /merged = \[\.\.\.merged\.filter\(\(field\) => !asked\.has\(field\.label\)\), \.\.\.step\.fields\]/, "within a step a repeated label stays");
  const preload = read("electron/browser-guest-preload.js");
  assert.match(preload, /fieldsBefore\.some\(\(other\) => candidate\.compareDocumentPosition\(other\) & Node\.DOCUMENT_POSITION_FOLLOWING\)\) break;/, "text with another field after it is that field's label");
  assert.match(preload, /read from the group's first option/);
});

test("「你已投过」 stays quiet about the 投递 just made", () => {
  assert.match(read("src/components/browser/site-banner.tsx"), /showApplied && !hideApplied && match/);
  assert.match(read("src/components/browser/embedded-browser.tsx"), /hideApplied=\{!!submitted \|\| \(!!currentUrl && recordedPages\.includes\(currentUrl\)\)\}/);
});
