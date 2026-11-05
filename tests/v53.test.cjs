const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
function loadTs(relative) {
  const compiled = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function (module, exports, require) {${compiled}\n})`, { filename: relative })(mod, mod.exports, require);
  return mod.exports;
}

const U = loadTs("src/lib/resume-used.ts");
const P = loadTs("src/lib/submission-package.ts");

// Made-up versions: stored files have hex names, as the App keeps them.
const versions = [
  { id: "r-motion", name: "数据分析", storedName: "aaaa1111.pdf", size: 1000 },
  { id: "r-test", name: "v1-软件测试", storedName: "bbbb2222.pdf", size: 2000 },
  { id: "r-sie-app", name: "华为终端", storedName: "cccc3333.pdf", size: 3000 },
  { id: "r-sie", name: "华为", storedName: "dddd4444.pdf", size: 4000 },
  { id: "r-tailored", name: "定制·示例科技·机器人测试工程师", storedName: "eeee5555.pdf", size: 5000 },
];

test("a picked file is matched to its 简历版本: same stored file, same size, else the name it carries", () => {
  assert.deepEqual(U.matchUpload({ name: "bbbb2222.pdf", size: 1 }, versions), { id: "r-test", how: "file" });
  assert.deepEqual(U.matchUpload({ name: "我的简历.pdf", size: 3000 }, versions), { id: "r-sie-app", how: "size" });
  assert.deepEqual(U.matchUpload({ name: "张三-华为终端 (2).pdf", size: 1 }, versions), { id: "r-sie-app", how: "name" }, "the longest name wins");
  assert.deepEqual(U.matchUpload({ name: "张三_V1-软件测试_最终版.PDF", size: 1 }, versions), { id: "r-test", how: "name" });
  assert.deepEqual(U.matchUpload({ name: "张三-示例科技-机器人测试工程师.pdf", size: 1 }, versions), { id: "r-tailored", how: "name" }, "an exported 定制 file carries company and job, not 「定制」");
  assert.equal(U.matchUpload({ name: "简历.pdf", size: 1 }, versions), null);
  assert.equal(U.matchUpload({ name: "x.pdf", size: 9 }, [...versions, { id: "dup", name: "别的", storedName: null, size: 9 }, { id: "dup2", name: "别的2", storedName: null, size: 9 }]), null, "two files of one size decide nothing");
  assert.equal(U.normalizeFileName("张三 - 数据分析（1）.pdf"), "张三数据分析");
});

test("the newest upload on these pages decides; then 一键填写's resume; then one tailored for the job", () => {
  const at = 1_800_000_000_000;
  assert.equal(U.pickResumeUsed({ uploads: [{ by: "autofill", at, resumeVersionId: "r-motion" }, { by: "page", at: at + 5000, name: "我的简历.pdf", size: 2000 }], versions }).resumeVersionId, "r-test");
  const auto = U.pickResumeUsed({ uploads: [{ by: "autofill", at, resumeVersionId: "r-motion" }], versions });
  assert.equal(auto.resumeVersionId, "r-motion");
  assert.match(auto.reason, /一键填写上传的是「数据分析」/);
  const unknown = U.pickResumeUsed({ uploads: [{ by: "page", at, name: "别人的简历.pdf", size: 7 }], versions, fillResumeId: "r-motion" });
  assert.equal(unknown.resumeVersionId, null, "a file it can't place is said so, not guessed");
  assert.match(unknown.reason, /别人的简历\.pdf.*请选一下/);
  assert.equal(U.pickResumeUsed({ uploads: [], versions, fillResumeId: "r-sie" }).resumeVersionId, "r-sie");
  const tailored = U.pickResumeUsed({ uploads: [], versions, tailoredForJob: { id: "r-tailored", name: "定制·示例科技·机器人测试工程师" } });
  assert.equal(tailored.resumeVersionId, "r-tailored");
  assert.match(tailored.reason, /为这个岗位定制的/);
  assert.deepEqual(U.pickResumeUsed({ uploads: [], versions }), { resumeVersionId: null, reason: "" });
  assert.equal(U.pickResumeUsed({ uploads: [{ by: "autofill", at, resumeVersionId: "deleted" }], versions, fillResumeId: "r-sie" }).resumeVersionId, "r-sie", "a deleted version is skipped");
});

test("HR sees 「姓名-简历.pdf」, never the stored hex name or the version's label", () => {
  assert.equal(U.resumeUploadName("张三", ".PDF"), "张三-简历.pdf");
  assert.equal(U.resumeUploadName(" 李 四/", ".docx"), "李四-简历.docx");
  assert.equal(U.resumeUploadName(null, ""), "个人-简历.pdf");
  for (const route of ["src/app/api/desktop-browser/resume-file/route.ts", "src/app/api/extension/resume-file/route.ts"]) assert.match(read(route), /resumeUploadName\(user\.name/);
  const view = read("electron/browser-view.js");
  assert.match(view, /uploadResumeFiles\(wc, await friendlyUploadCopy\(file\.path, file\.uploadName\), stillOnPage\)/);
  assert.match(view, /"cp-resume-upload", crypto\.randomBytes/, "each upload keeps its own copy until the form is sent");
});

test("a long form is trimmed into the 材料包, never refused", () => {
  const fields = Array.from({ length: 300 }, (_, i) => ({ label: `${"很长的题目".repeat(60)}${i}`, value: "x".repeat(30000) }));
  const parsed = P.submissionSnapshotSchema.parse({ url: "https://example.com/apply", fields });
  assert.equal(parsed.fields.length, 250);
  assert.equal(parsed.fields[0].label.length, 200);
  assert.equal(parsed.fields[0].value.length, 20000);
});

test("recording trusts the applicant's choices and keeps the JD", () => {
  const action = read("src/lib/actions/submitted-application.ts");
  assert.doesNotMatch(action, /所选简历与浏览器填写时的简历不一致|当前选择的岗位与填写时的岗位不同/);
  assert.match(action, /const jd = position\?\.jdText \|\| data\.jd\?\.text\?\.trim\(\) \|\| ""/);
  assert.match(action, /if \(position && !position\.jdText && data\.jd\?\.text\?\.trim\(\)\)/);
  const view = read("electron/browser-view.js");
  assert.match(view, /page\.fields >= 12 \|\| text\.length < 150 \|\| !JD_DUTIES\.test\(text\) \|\| !JD_NEEDS\.test\(text\)/, "a JD names duties and requirements and is not itself a form");
  assert.match(view, /uploads: tab\.resumeUploads \|\| \[\], jdPage \}/);
  assert.match(view, /last\.by === "autofill" && now - last\.at < 8000/, "一键填写's own change event is not counted twice");
  assert.match(view, /filter\(\(u\) => !\(u\.by === "page" && Date\.now\(\) - u\.at < 8000\)\)/, "nor when it arrives just before 一键填写 finishes");
  assert.match(view, /\/\\\.\(\?:pdf\|docx\?\)\$\/i\.test\(file\.name\)/, "a photo upload is not a resume");
  const preload = read("electron/browser-guest-preload.js");
  assert.match(preload, /document\.addEventListener\("change"/);
  assert.match(preload, /document\.addEventListener\("drop"/);
  assert.match(preload, /ipcRenderer\.send\("browser-guest:files", files\)/);
  assert.doesNotMatch(preload, /FileReader|arrayBuffer\(|\.text\(\)/, "the file itself is never read");
});

test("投递成功: one click with the resume shown, 撤销 after; the dialog says why it picked a resume", () => {
  const browser = read("src/components/browser/embedded-browser.tsx");
  assert.match(browser, /async function recordSubmittedNow\(\)/);
  assert.match(browser, /核对后再记…/);
  assert.match(browser, /，简历「\{resumeName\}」/);
  assert.match(browser, /label: "撤销", onClick: \(\) => void deleteApplication\(body\.id\)/);
  assert.match(browser, /用定制的简历/);
  const dialog = read("src/components/browser/mark-applied-from-browser.tsx");
  assert.match(dialog, /guessResumeUsed\(\{/);
  assert.match(dialog, /没看到这次上传了哪份简历/);
  assert.match(dialog, /jd \? "JD 已一起保存" : ""/);
  assert.match(read("src/lib/actions/resume-used.ts"), /sites\.has\(siteKey\(u\.url\) \?\? hostOf\(u\.url\)\)/, "another company's upload in the same tab is left out");
  assert.match(browser, /result\?\.companyName && result\.title && !resumeUnsure \?/, "a file it can't place is checked, not recorded as the default");
  const view = read("electron/browser-view.js");
  assert.match(view, /Date\.now\(\) - tab\.jdPage\.at < 2 \* 3600_000 && visited\.has\(tab\.jdPage\.url\)/, "only a JD this tab went through lately");
  assert.match(read("src/lib/actions/submitted-application.ts"), /cityFromJobText\(data\.jd\.text\)/);
});
