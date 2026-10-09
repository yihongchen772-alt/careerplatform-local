const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Which company and job a just-submitted 网申 was, from what the browser saw.
function loadTs(relative, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: (name) => mocks[name] ?? (name.startsWith("@/") ? loadTs(`src/${name.slice(2)}.ts`) : require(name)), URL });
  return mod.exports;
}
const { identifyApplication, identityFieldsForAi, tidyIdentity, withAiAnswer } = loadTs("src/lib/application-identity.ts");

const page = (url, title) => ({ url, title });
const input = (overrides) => ({ url: "https://careers.example.invalid/apply/success", title: "投递成功", text: "投递成功，请留意邮件通知。", siteName: null, history: [], fields: [], ...overrides });

test("a candidate-pool job is recognised from its own page in this tab's history", () => {
  const pool = [
    { id: "p1", companyName: "星海科技", title: "数据分析师", jdUrl: "https://careers.xinghai.example.invalid/jobs/123" },
    { id: "p2", companyName: "星海科技", title: "算法工程师", jdUrl: "https://careers.xinghai.example.invalid/jobs/456" },
  ];
  const result = identifyApplication(input({
    url: "https://careers.xinghai.example.invalid/apply/success",
    history: [page("https://careers.xinghai.example.invalid/jobs/123", "数据分析师 - 星海科技校园招聘"), page("https://careers.xinghai.example.invalid/apply/123", "填写简历")],
  }), pool, []);
  assert.equal(result.positionId, "p1");
  assert.equal(result.title, "数据分析师");
  // Same site, two jobs: the job named on the page decides.
  const byTitle = identifyApplication(input({ url: "https://careers.xinghai.example.invalid/apply/x", text: "您已成功投递「算法工程师」岗位" }), pool, []);
  assert.equal(byTitle.positionId, "p2");
});

test("company from a known site and job from the form's 应聘岗位 field", () => {
  const sites = [{ companyName: "远航集团", keys: ["mokahr.com/yuanhang"] }];
  const result = identifyApplication(input({
    url: "https://app.mokahr.com/campus-recruitment/yuanhang/1234#/apply/success",
    fields: [{ label: "公司名称", value: "字节跳动" }, { label: "*应聘岗位：", value: "管理培训生" }],
  }), [], sites);
  assert.equal(result.companyName, "远航集团");
  assert.equal(result.title, "管理培训生");
  assert.equal(result.positionId, undefined);
  assert.ok(result.evidence.some((line) => line.includes("应聘岗位")));
});

test("page titles name the employer and the job on an unknown portal", () => {
  const result = identifyApplication(input({
    history: [page("https://jobs.zhiye.example.invalid/campus/jobs/77", "数据分析师（2026届校招） - 星海科技校园招聘 | 职位详情"), page("https://jobs.zhiye.example.invalid/campus/apply/77", "个人中心")],
  }), [], []);
  assert.equal(result.companyName, "星海科技");
  assert.equal(result.title, "数据分析师");
});

test("the success page's own wording names the job, and the employer when it says so", () => {
  const quoted = identifyApplication(input({ text: "恭喜！您已成功投递「算法工程师（2026届校招）」岗位，请耐心等待。" }), [], []);
  assert.equal(quoted.title, "算法工程师");
  const sentence = identifyApplication(input({ text: "感谢您申请远航集团的管培生职位，我们会尽快联系您。" }), [], []);
  assert.equal(sentence.title, "管培生");
  assert.equal(sentence.companyName, "远航集团");
});

test("English ATS titles split into the employer and the role", () => {
  const result = identifyApplication(input({
    url: "https://acme.wd5.myworkdayjobs.example.invalid/Graduates/job/Shanghai/Graduate-Data-Analyst_R123/apply/thanks",
    title: "Application Submitted",
    text: "Thank you for applying.",
    history: [page("https://acme.wd5.myworkdayjobs.example.invalid/Graduates/job/Shanghai/Graduate-Data-Analyst_R123", "Graduate Data Analyst - Acme Careers")],
  }), [], []);
  assert.equal(result.companyName, "Acme");
  assert.equal(result.title, "Graduate Data Analyst");
});

test("a pool job matching the recognised names is linked; generic pages yield nothing rather than guesses", () => {
  const pool = [{ id: "p9", companyName: "星海科技", title: "数据分析师", jdUrl: null }];
  const linked = identifyApplication(input({ history: [page("https://jobs.other.example.invalid/x", "数据分析师 - 星海科技校园招聘")] }), pool, []);
  assert.equal(linked.positionId, "p9");
  const nothing = identifyApplication(input({ title: "投递成功", history: [page("https://hr.example.invalid/login", "登录"), page("https://hr.example.invalid/center", "个人中心")] }), [], []);
  assert.equal(nothing.companyName, "");
  assert.equal(nothing.title, "");
  // 意向岗位 is the last resort for the job.
  const wish = identifyApplication(input({ fields: [{ label: "意向岗位", value: "数据分析" }] }), [], []);
  assert.equal(wish.title, "数据分析");
});

test("an internship's 职位名称 is never taken for the job applied to", () => {
  const fields = [{ label: "公司名称", value: "字节跳动" }, { label: "*职位名称", value: "数据分析实习生" }];
  const result = identifyApplication(input({ fields, history: [page("https://jobs.zhiye.example.invalid/campus/jobs/9", "算法工程师 - 星海科技校园招聘")] }), [], []);
  assert.equal(result.title, "算法工程师");
  assert.equal(identifyApplication(input({ fields }), [], []).title, "");
  // A lone 职位名称 on a form without any employer fields is the job itself.
  assert.equal(identifyApplication(input({ fields: [{ label: "职位名称", value: "管理培训生" }] }), [], []).title, "管理培训生");
  // 第一志愿 is the job; 志愿者经历 is not a wish.
  assert.equal(identifyApplication(input({ fields: [{ label: "志愿者经历", value: "社区志愿服务" }, { label: "第一志愿岗位", value: "柜员" }] }), [], []).title, "柜员");
});

test("recruiting platforms, years, pronouns and step names are not employers", () => {
  const none = (overrides) => identifyApplication(input(overrides), [], []).companyName;
  assert.equal(none({ title: "个人中心 - Moka招聘" }), "");
  assert.equal(none({ siteName: "Moka" }), "");
  assert.equal(none({ title: "智联招聘 - 投递成功" }), "");
  assert.equal(none({ title: "个人信息 - 校园招聘" }), "");
  assert.equal(none({ title: "社会招聘 | 职位列表" }), "");
  assert.equal(none({ text: "您已成功投递了我们的数据分析师岗位。" }), "");
  assert.equal(identifyApplication(input({ text: "您已成功投递了我们的数据分析师岗位。" }), [], []).title, "数据分析师");
  assert.equal(none({ title: "2026届校园招聘 | 星海科技" }), "星海科技");
  assert.equal(none({ title: "星海科技 - 校园招聘" }), "星海科技");
  assert.equal(none({ title: "欢迎来到星海科技2026春季校园招聘" }), "星海科技");
  assert.equal(none({ title: "华为技术有限公司校园招聘" }), "华为技术有限公司");
  assert.equal(none({ text: "投递成功！感谢您对远航集团的关注。" }), "远航集团");
  assert.equal(none({ text: "Thank you for applying to Acme! We will be in touch." }), "Acme");
});

test("labelled success pages and English roles that contain page words", () => {
  assert.equal(identifyApplication(input({ text: "投递成功\n投递职位：数据分析师\n投递时间：2026-10-09" }), [], []).title, "数据分析师");
  assert.equal(identifyApplication(input({ text: "感谢您的申请，您申请的岗位是数据分析师 请留意邮件通知" }), [], []).title, "数据分析师");
  // The employer's name is cut only where it stands apart from the job's.
  assert.equal(tidyIdentity("星海科技", "星海科技 - 数据分析师").title, "数据分析师");
  assert.equal(tidyIdentity("华为", "华为云产品经理").title, "华为云产品经理");
  const research = identifyApplication(input({ history: [page("https://acme.example.invalid/jobs/1", "Research Scientist - Acme Careers")] }), [], []);
  assert.equal(research.title, "Research Scientist");
  assert.equal(research.companyName, "Acme");
});

test("another job on the same ATS is not mistaken for the saved one", () => {
  // Moka keeps the job in the hash route: a different #/job/… is a different job.
  const pool = [{ id: "a", companyName: "远航集团", title: "管理培训生", jdUrl: "https://app.mokahr.example.invalid/campus/yuanhang/1#/job/a" }];
  const other = identifyApplication(input({
    url: "https://app.mokahr.example.invalid/campus/yuanhang/1#/apply/success",
    history: [page("https://app.mokahr.example.invalid/campus/yuanhang/1#/job/b", "产品经理 - 远航集团校园招聘")],
  }), pool, []);
  assert.equal(other.positionId, undefined);
  assert.equal(other.title, "产品经理");
  const same = identifyApplication(input({ url: "https://app.mokahr.example.invalid/campus/yuanhang/1#/apply/success", history: [page("https://app.mokahr.example.invalid/campus/yuanhang/1#/job/a", "远航集团")] }), pool, []);
  assert.equal(same.positionId, "a");
  // Two recorded companies on one shared host: only a page naming one decides.
  const sites = [{ companyName: "星海科技", keys: ["example.invalid"] }, { companyName: "远航集团", keys: ["example.invalid"] }];
  assert.equal(identifyApplication(input({ url: "https://jobs.shared.example.invalid/x" }), [], sites).companyName, "");
  assert.equal(identifyApplication(input({ url: "https://jobs.shared.example.invalid/x", title: "远航集团 - 投递成功" }), [], sites).companyName, "远航集团");
  // One recorded company on a recruiting platform's host: a page stating
  // another employer wins over the address.
  const platform = [{ companyName: "远航集团", keys: ["example.invalid"] }];
  const stated = identifyApplication(input({ url: "https://jobs.shared.example.invalid/ok", history: [page("https://jobs.shared.example.invalid/j/7", "数据分析师 - 星海科技校园招聘")] }), [], platform);
  assert.equal(stated.companyName, "星海科技");
  assert.equal(identifyApplication(input({ url: "https://jobs.shared.example.invalid/ok", history: [page("https://jobs.shared.example.invalid/j/8", "数据分析师 - 远航集团上海分公司校园招聘")] }), [], platform).companyName, "远航集团");
  assert.equal(identifyApplication(input({ url: "https://jobs.shared.example.invalid/ok", history: [page("https://jobs.shared.example.invalid/j/9", "产品经理 - 远航科技事业群")] }), [], platform).companyName, "远航集团");
});

test("only job-naming fields are offered to the AI, never internship employers or personal details", () => {
  const fields = [{ label: "姓名", value: "林晓舟" }, { label: "公司名称", value: "字节跳动" }, { label: "应聘岗位", value: "数据分析师" }, { label: "手机号码", value: "13800000000" }, { label: "报考单位", value: "远航集团" }];
  assert.deepEqual(identityFieldsForAi(fields).map((field) => field.label), ["应聘岗位", "报考单位"]);
});

test("the AI only fills blanks, is held to the same rules, and can still link the pool job", () => {
  assert.deepEqual({ ...tidyIdentity("Moka", "数据分析师（2026届校招）") }, { companyName: "", title: "数据分析师" });
  assert.equal(tidyIdentity("星海科技2026届", "").companyName, "星海科技");
  const pool = [{ id: "p1", companyName: "星海科技", title: "数据分析师", jdUrl: null }];
  const found = { companyName: "星海科技", title: "", evidence: ["页面标题"] };
  const merged = withAiAnswer(found, { companyName: "别的公司", title: "数据分析师" }, pool);
  assert.equal(merged.positionId, "p1");
  assert.equal(merged.companyName, "星海科技");
  assert.ok(merged.usedAi);
  assert.ok(merged.evidence.includes("AI 根据页面判断"));
  const nothing = withAiAnswer({ companyName: "", title: "", evidence: [] }, {}, pool);
  assert.equal(nothing.usedAi, false);
  assert.equal(nothing.positionId, undefined);
});
