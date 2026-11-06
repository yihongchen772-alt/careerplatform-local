const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const core = require("../electron/autofill-core.js");

test("the record's answers come from the engine's own reading: every field type, nothing private", () => {
  const scan = (prefix, readOnly) => {
    assert.equal(prefix, "readonly-");
    assert.equal(readOnly, true, "a read-only scan marks nothing on the page");
    return [
      { label: "姓名", tag: "input", type: "text", currentValue: "张三" },
      { label: "最高学历", tag: "custom-select", type: "", currentValue: "硕士" },
      { label: "", placeholder: "请选择意向城市", tag: "custom-select", type: "", currentValue: "上海" },
      { label: "是否接受调剂", tag: "radio", type: "radio", currentValue: "是" },
      { label: "自我评价", tag: "richtext", type: "", currentValue: "x".repeat(6000) },
      { label: "还没填", tag: "input", type: "text", currentValue: "" },
      { label: "身份证号", tag: "input", type: "text", currentValue: "110101199001011234" },
      { label: "备注", tag: "input", type: "text", currentValue: "110101199001011234" },
      { label: "登录密码", tag: "input", type: "password", currentValue: "secret" },
      { label: "银行卡号", tag: "input", type: "text", currentValue: "6222" },
      { label: "简历", tag: "input", type: "file", currentValue: "a.pdf" },
      { label: "姓名", tag: "input", type: "text", currentValue: "张三" },
      { label: "学校", tag: "input", type: "text", currentValue: "甲大学" },
      { label: "学校", tag: "input", type: "text", currentValue: "乙大学" },
      { label: "学校", tag: "input", type: "text", currentValue: "乙大学" },
      { label: "推荐方式*", tag: "custom-select", type: "", currentValue: "校园招聘" },
      { label: "学校", tag: "input", type: "text", currentValue: "甲大学" },
    ];
  };
  const fields = core.readFormAnswers(scan);
  assert.deepEqual(fields.map((f) => f.label), ["姓名", "最高学历", "请选择意向城市", "是否接受调剂", "自我评价", "姓名", "学校", "学校", "推荐方式", "学校"], "one box read twice in a row is one answer; two records with the same value are two");
  assert.equal(fields.find((f) => f.label === "最高学历").value, "硕士");
  assert.equal(fields.find((f) => f.label === "自我评价").value.length, 5000);
});

test("it runs at the send click, and a page that has moved on keeps the quick copy", () => {
  const view = read("electron/browser-view.js");
  assert.match(view, /ipcMain\.on\("browser-guest:form-sent", async \(event, payload\) =>/);
  assert.match(view, /readFormAnswers\.toString\(\)\}\)\(\$\{scanPageFields\.toString\(\)\}\)/);
  assert.match(view, /remember\(quick\);/, "kept first, in case the page goes");
  assert.match(view, /wc\.getURL\(\)\.slice\(0, 2000\) !== url \|\| !read\.length\) return;/, "a reading from the next page is not this form's");
  assert.match(view, /quick\.filter\(\(field\) => !labels\.has\(field\.label\) && !values\.has\(field\.value\)\)/, "no answer twice under two labels");
  assert.match(read("tests/fill-lab/run.mjs"), /记录读得回/, "every fill-lab scenario checks that what it filled reads back");
});

test("a JD read off the page is kept as a 岗位 already 已投递, so every feature can use it; 撤销 takes it away", () => {
  const action = read("src/lib/actions/submitted-application.ts");
  assert.match(action, /status: "APPLIED" \}, select: \{ id: true \} \}\)/);
  assert.match(action, /if \(!position && jdRead\)/, "only for a job outside the pool with a JD");
  assert.match(action, /tx\.position\.findFirst\(\{ where: \{ userId: user\.id, companyId, title: data\.title \}/, "the same job isn't kept twice");
  assert.match(action, /createdPositionId: kept\?\.created \? kept\.id : null/);
  assert.match(action, /export async function undoSubmittedApplication/);
  assert.match(action, /applications: \{ none: \{\} \}/, "never a 岗位 another 投递 still uses");
  for (const file of ["src/components/browser/embedded-browser.tsx", "src/components/browser/mark-applied-from-browser.tsx"]) assert.match(read(file), /undoSubmittedApplication\(/);
});

const vm = require("node:vm");
const ts = require("typescript");
function loadTs(relative) {
  const compiled = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function (module, exports, require) {${compiled}\n})`, { filename: relative })(mod, mod.exports, (name) => (name.startsWith("@/") ? loadTs(`src/${name.slice(2)}.ts`) : require(name)));
  return mod.exports;
}
const { identifyApplication } = loadTs("src/lib/application-identity.ts");
// Made-up names in the layouts real recruiting sites use.
const identify = ({ title = "校园招聘", jd = "", headings = [] }) => identifyApplication({ url: "https://jobs.example-tech.cn/done", title: "投递结果", text: "投递成功", siteName: null, history: [{ url: "https://jobs.example-tech.cn/job/9", title }], fields: [], jdText: jd, jdHeadings: headings }, [], []);
const page = (...lines) => [...lines, "任职要求", "硕士学历"].join("\n");

test("the job is above 职位描述, not above the breadcrumb that says 职位详情", () => {
  assert.equal(identify({ jd: page("首页", "校招职位", "登录", "首页/职位列表/职位详情", "（校招）结构开发工程师-星云", "分享", "研发中心", "发布于 2026-09-04", "申请职位", "职位描述", "负责结构开发") }).title, "结构开发工程师-星云");
  assert.equal(identify({ jd: page("首页/职位列表/职位详情", "2027校招-图像算法工程师（感知方向）", "分享", "全职|研发部", "申请职位", "职位描述") }).title, "图像算法工程师（感知方向）", "全职|研发部 is a tag line");
  assert.equal(identify({ jd: page("研发技术", "岗位职责", "负责研发") }).title, "", "a job family is not a job");
  assert.equal(identify({ jd: page("类别：测试工程师", "岗位职责") }).title, "", "a 标签：值 line is not a job");
});

test("the biggest text on the page names the job; batch, employer and posting code come off", () => {
  assert.equal(identify({ headings: ["视觉算法工程师", "登录", "上海"], jd: page("研发技术", "岗位职责") }).title, "视觉算法工程师");
  assert.equal(identify({ title: "星海微电子招聘", headings: ["星海微电子-研发测试工程师-2027校园招聘(J10001)", "首页"], jd: page("岗位职责") }).title, "研发测试工程师");
  assert.equal(identify({ headings: ["导航算法工程师-南京-2027届秋招(R0123)"], jd: page("岗位职责") }).title, "导航算法工程师-南京", "a city or division stays");
  assert.equal(identify({ headings: ["软件开发工程师(J10002)"], jd: page("岗位职责") }).title, "软件开发工程师");
  assert.equal(identify({ headings: ["研发/设计工程师", "首页"], jd: page("岗位职责") }).title, "研发/设计工程师");
  assert.equal(identify({ headings: ["2027届校招-采购管理岗（星火计划）(010203)"], jd: page("岗位职责") }).title, "采购管理岗（星火计划）");
  assert.equal(identify({ headings: ["【27届校招】QE工程师", "登录"], jd: page("岗位职责") }).title, "QE工程师");
  assert.equal(identify({ headings: ["加入我们", "首页", "全职|研发部"], jd: page("岗位职责") }).title, "");
});

test("the employer from titles real sites use", () => {
  const company = (title) => identify({ title }).companyName;
  assert.equal(company("星海科技 - 期待您的加入！"), "星海科技", "a name beside a slogan");
  assert.equal(company("星海微电子装备有限公司"), "星海微电子装备有限公司", "a title that is the organisation");
  assert.equal(company("优星科技"), "优星科技");
  assert.equal(company("加入星海机器人"), "星海机器人", "飞书招聘's page title");
  assert.equal(company("硬件工程师 - 电源方向 - 欢迎加入星海科技"), "星海科技");
  assert.equal(company("硬件工程师（校招） - Join Star Robotics"), "Star Robotics");
  assert.equal(company("星海汽车 奔向远方 | 职位详情"), "星海汽车", "the name, not the slogan after it");
  assert.equal(company("加入星海机器人！"), "星海机器人", "without its exclamation mark");
  assert.equal(company("加入星海集团“星火计划”"), "星海集团", "or the programme's name");
  assert.equal(identify({ title: "底盘工程师（2027届-南京） - 星海科技校园招聘" }).title, "底盘工程师", "a dash inside brackets doesn't divide the title");
  const onTenant = (title) => identifyApplication({ url: "https://starsea.zhiye.com/form", title, text: "", siteName: null, history: [], fields: [] }, [], []).companyName;
  assert.equal(onTenant("星海创新"), "星海创新", "a 北森 site titled with the brand alone");
  assert.equal(onTenant("投递简历"), "");
  assert.equal(company("星海创新"), "", "elsewhere a lone title says too little");
  assert.equal(company("加入我们"), "");
  assert.equal(company("校园招聘"), "");
});

test("a 志愿 field names the job only when it is the first choice of a job", () => {
  const job = (fields) => identifyApplication({ url: "https://jobs.example-tech.cn/form", title: "星海科技有限公司", text: "", siteName: null, history: [], fields, jdText: "", jdHeadings: [] }, [], []).title;
  assert.equal(job([{ label: "第二志愿城市", value: "南京" }]), "", "a city is not a job");
  assert.equal(job([{ label: "第一志愿城市", value: "南京" }]), "");
  assert.equal(job([{ label: "第二志愿岗位", value: "测试工程师" }]), "", "the second choice is not what was applied for");
  assert.equal(job([{ label: "第二志愿城市", value: "南京" }, { label: "第一志愿岗位", value: "硬件工程师" }]), "硬件工程师");
  assert.equal(job([{ label: "志愿者经历", value: "社区服务" }, { label: "意向岗位", value: "硬件工程师" }]), "硬件工程师");
});

test("no made-up questions in the record: a dropdown's own value is not a label, the header's job search is not a field", () => {
  const preload = read("electron/browser-guest-preload.js");
  assert.match(preload, /label === value \|\| \/\^\[\\d\\s\+/);
  const engine = read("electron/autofill-core.js");
  assert.match(engine, /The site's own job search/);
  assert.match(read("tests/fill-lab/run.mjs"), /搜索框不算题目/);
  assert.match(read("electron/browser-view.js"), /\\\*\{2,\}\/\.test\(line\)/, "the signed-in account is no heading");
});

test("answers read clean: dates whole, no +86, a validation message is not a value", () => {
  const scan = () => [
    { label: "手机号码", tag: "custom-select", currentValue: "+86" },
    { label: "手机号码", tag: "input", currentValue: "13800000000" },
    { label: "就读时间", tag: "custom-select", datePart: "year", currentValue: "2024年" },
    { label: "就读时间", tag: "custom-select", datePart: "month", currentValue: "9" },
    { label: "就读时间", tag: "custom-select", datePart: "year", currentValue: "2026" },
    { label: "就读时间", tag: "custom-select", datePart: "month", currentValue: "6" },
    { label: "起止时间", tag: "custom-select", datePart: "year", currentValue: "2025" },
    { label: "起止时间", tag: "custom-select", datePart: "month", currentValue: "" },
    { label: "公司", tag: "input", currentValue: "甲公司" },
  ];
  assert.deepEqual(core.readFormAnswers(scan).map((f) => `${f.label}=${f.value}`), ["手机号码=13800000000", "就读时间=2024-09 ~ 2026-06", "起止时间=2025", "公司=甲公司"]);
  const engine = read("electron/autofill-core.js");
  assert.equal((engine.match(/\^\(\?:此项\|该项\|本项\)\?必填\|未填写\$\|不能为空\$/g) || []).length, 4, "every copy of the placeholder rule knows validation messages");
  assert.match(read("tests/fill-lab/run.mjs"), /"validation-msg": \[\[/);
  assert.match(read("tests/fill-lab/run.mjs"), /"jd-heading": \[\[/);
});
