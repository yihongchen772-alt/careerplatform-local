// 网申填写多场景实测台：在真实 Chromium 里用共享填写引擎填 16 个仿真表单
// （AntD 仿 Moka、Element Plus iframe 仿北森、老式表格仿大易、英文 Workday 式、
// 手写控件、Shadow DOM、已有内容保护、自动补齐栏目、Semi 式下拉、分步向导、已保存经历卡片、长表头、各栏目一条一条填），
// 逐字段核对结果。全部是虚构资料，不访问任何真实网站或 App 数据。
//
//   npm run test:fill-lab            全部场景
//   npm run test:fill-lab -- dayee-table workday-en   指定场景
//   VERBOSE=1 / SHOT=1               打印完整结果说明 / 保存整页截图到 .vendor/
//
// 首次运行会把固定版本的 React、AntD、Vue、Element Plus 下载到 .vendor/（已在
// .gitignore 中）。CI 不跑这个：它需要 Chromium，匹配规则另有
// tests/autofill-scenarios.test.cjs。
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../../electron/autofill-core.js");
const viewSource = fs.readFileSync(new URL("../../electron/browser-view.js", import.meta.url), "utf8");
const LAB = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(LAB, ".vendor");
const only = process.argv.slice(2);

const LIBRARIES = {
  "react.js": "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
  "react-dom.js": "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js",
  "dayjs.js": "https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js",
  "antd.js": "https://cdn.jsdelivr.net/npm/antd@5.21.6/dist/antd.min.js",
  "antd-reset.css": "https://cdn.jsdelivr.net/npm/antd@5.21.6/dist/reset.css",
  "vue.js": "https://cdn.jsdelivr.net/npm/vue@3.5.12/dist/vue.global.prod.js",
  "element-plus.js": "https://cdn.jsdelivr.net/npm/element-plus@2.8.8/dist/index.full.min.js",
  "element-plus.css": "https://cdn.jsdelivr.net/npm/element-plus@2.8.8/dist/index.css",
  "element-zh.js": "https://cdn.jsdelivr.net/npm/element-plus@2.8.8/dist/locale/zh-cn.min.js",
  // B 站式：老版 Ant Design Vue 1.x（Vue 2），选择框和日历的结构和新版不同。
  "vue2.js": "https://cdn.jsdelivr.net/npm/vue@2.7.16/dist/vue.min.js",
  "moment.js": "https://cdn.jsdelivr.net/npm/moment@2.30.1/min/moment.min.js",
  "antdv1.js": "https://cdn.jsdelivr.net/npm/ant-design-vue@1.7.8/dist/antd.min.js",
  "antdv1.css": "https://cdn.jsdelivr.net/npm/ant-design-vue@1.7.8/dist/antd.min.css",
};
fs.mkdirSync(VENDOR, { recursive: true });
for (const [name, url] of Object.entries(LIBRARIES)) {
  const file = path.join(VENDOR, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
  process.stdout.write(`下载 ${name}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 ${url} 失败：${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log("完成");
}

const PROFILE = {
  fieldMemories: [], mappings: [], variantName: null,
  name: "林晓舟", phone: "13812345678", email: "linxz@example.invalid", gender: "女",
  birthDate: "2002-03-15", school: "复旦大学", targetTrack: "数据分析", graduationYear: 2026,
  preferredCities: "上海", major: "统计学", degree: "硕士", gpa: "3.8/4.0",
  educationStart: "2024-09", educationEnd: "2026-06", latestCompany: "字节跳动", latestRole: "数据分析实习生",
  education: [
    { school: "复旦大学", major: "统计学", department: "管理学院", degree: "硕士", gpa: "3.8/4.0", start: "2024-09", end: "2026-06" },
    { school: "南京大学", major: "数学与应用数学", degree: "本科", gpa: "3.7/4.0", start: "2020-09", end: "2024-06" },
  ],
  experiences: [
    { company: "字节跳动", department: "抖音电商数据组", role: "数据分析实习生", start: "2025-06", end: "2025-09", description: "负责抖音电商用户增长分析，搭建 AB 实验看板。" },
  ],
  projects: [{ name: "校园二手交易推荐系统", role: "负责人", start: "2025-03", end: "2025-06", description: "基于协同过滤的推荐系统", responsibilities: "负责模型设计与评估" }],
  awards: [{ name: "全国大学生数学建模竞赛一等奖", issuer: "中国工业与应用数学学会", level: "国家级", date: "2023-11", description: "" }],
  campus: [{ name: "复旦大学研究生会", role: "学术部部长", level: "校级", start: "2024-09", end: "2025-06", description: "组织学术沙龙 12 场" }],
  skills: [{ name: "Python", level: "熟练", category: "编程语言", description: "" }, { name: "Tableau", level: "熟悉", category: "软件工具", description: "" }],
  languages: [{ name: "CET-6", language: "", score: "560", date: "2023-06" }, { name: "雅思", language: "英语", score: "7.0", date: "2024-03" }],
  researchDirection: "因果推断与增长分析", rank: "前 10%", acceptAdjust: "是", courses: "多元统计分析、机器学习、时间序列", department: "管理学院",
  qq: "123456789", englishName: "Zoe Lin", exchange: "无", homepage: "https://github.com/linxz-example", hobbies: "摄影、羽毛球", thesis: "基于因果推断的用户增长归因研究", lab: "统计学习实验室",
  library: [], summaries: {},
  politics: "共青团员", hometown: "江苏南京", ethnicity: "汉族", english: "CET-6 560", currentCity: "上海",
  targetRole: "数据分析师", selfIntro: "统计学硕士，熟悉 SQL 与 Python，做过电商增长分析。",
  extra: "",
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = pathname.startsWith("/vendor/") ? path.join(VENDOR, pathname.slice(8)) : path.join(LAB, pathname);
  if (!file.startsWith(LAB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

function fakeAi(questions) {
  return questions.map((q) => {
    // A dropdown reaches the AI with the choices the page really offers, and every box with its section.
    // Which 省份 a named school is in: the question has to carry the school.
    if (/所在的省份或地区/.test(q.label)) { const place = /复旦/.test(q.label) ? "上海" : /南京大学/.test(q.label) ? "江苏省" : ""; return { id: q.id, answer: (q.options || []).includes(place) ? place : "NEEDS_MANUAL_INPUT" }; }
    if (/校区/.test(q.label)) return { id: q.id, answer: q.kind === "choice" && (q.options || []).includes("本部") ? "本部" : "NEEDS_MANUAL_INPUT" };
    if (/兴趣小组/.test(q.label)) return { id: q.id, answer: `所在栏目=${q.section || "无"}` };
    if (q.kind === "choice") {
      const yes = (q.options || []).find((o) => /^(?:是|yes)$/i.test(o));
      if (/调剂|authori[sz]ed|外派|派遣/i.test(q.label) && yes) return { id: q.id, answer: yes };
      if (/hear about/i.test(q.label)) { const site = (q.options || []).find((o) => /company website/i.test(o)); if (site) return { id: q.id, answer: site }; }
      return { id: q.id, answer: "NEEDS_MANUAL_INPUT" };
    }
    if (q.kind === "essay") return { id: q.id, answer: `【AI草稿】${q.label.slice(0, 12)}` };
    if (/hear about/i.test(q.label)) return { id: q.id, answer: "Company Website" };
    // Told what this module already saved, a different entry comes back.
    const savedText = (q.saved || []).join(" ");
    if (/证书名称/.test(q.label)) return { id: q.id, answer: savedText.includes("六级") ? "计算机二级证书" : "英语六级证书" };
    if (/颁发机构/.test(q.label)) return { id: q.id, answer: savedText.includes("六级") ? "教育部考试中心" : "全国大学英语四六级考试委员会" };
    return { id: q.id, answer: "NEEDS_MANUAL_INPUT" };
  });
}

function manyEntries(p) {
  p.projects = [...p.projects, { name: "用户留存归因分析", role: "数据分析", start: "2024-09", end: "2024-12", description: "用分层回归拆解留存变化", responsibilities: "负责指标口径与建模" }];
  p.awards = [...p.awards, { name: "国家奖学金", issuer: "教育部", level: "国家级", date: "2023-10", description: "" }, { name: "校级优秀学生干部", issuer: "", level: "校级", date: "2023-12", description: "" }];
}

async function runPage(browser, name, checks, { wait = 600, options = {}, page: pageName, query = "", between, profile: patchProfile } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/pages/${pageName || name}.html${query}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(wait);
  const statuses = [];
  const aiQuestions = [];
  let drafts = [];
  const taskId = "lab-task";
  for (const f of page.frames()) await f.evaluate(`document.documentElement.setAttribute("data-cp-task", ${JSON.stringify(taskId)})`).catch(() => {});
  const adapter = {
    url: () => page.url(),
    stillOnPage: (u) => page.url() === u,
    taskId,
    frames: async () => page.frames(),
    run: (frame, fn, args = []) => frame.evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`),
    api: async (apiName, init) => {
      if (apiName.startsWith("profile")) return { ok: true, json: async () => { const copy = structuredClone(PROFILE); if (patchProfile) patchProfile(copy); return copy; } };
      if (apiName === "answer-questions") {
        const body = JSON.parse(init.body);
        aiQuestions.push(...body.questions);
        return { ok: true, json: async () => ({ answers: fakeAi(body.questions) }) };
      }
      return { ok: false, json: async () => ({}) };
    },
    status: (p) => statuses.push(p),
    uploadResume: async () => 0,
    getDrafts: () => drafts,
    setDrafts: (l) => { drafts = l; },
    getPlan: () => null,
    setPlan: async () => {},
    archiveScope: () => "page:v2:lab",
  };
  const started = Date.now();
  let result = await core.runAutofillCore(adapter, "resume-1", { modules: core.AUTOFILL_MODULES || undefined, ...options });
  if (between) {
    const note = await between(page);
    if (note) console.log("  中间步骤:", note);
    for (const f of page.frames()) await f.evaluate(`document.documentElement.setAttribute("data-cp-task", ${JSON.stringify(taskId)})`).catch(() => {});
    result = await core.runAutofillCore(adapter, "resume-1", { modules: core.AUTOFILL_MODULES || undefined, ...options });
  }
  const elapsed = Date.now() - started;
  await page.waitForTimeout(300);
  let pass = 0;
  const lines = [];
  for (const check of checks) {
    const frame = check.frame ? page.frames().find((f) => f.url().includes(check.frame)) : page.mainFrame();
    let actual;
    // `result`: a check on what 一键填写 reported (its notes, the 补齐 button), not on the page.
    try { actual = check.result ? check.result(result) : await frame.evaluate(check.read); } catch (e) { actual = `<<error ${e.message.slice(0, 80)}>>`; }
    actual = actual == null ? "" : String(actual).trim();
    const ok = check.expect instanceof RegExp ? check.expect.test(actual) : actual === check.expect;
    if (ok) pass++;
    lines.push(`  ${ok ? "✓" : "✗"} ${check.label.padEnd(18)} 实际=${JSON.stringify(actual).slice(0, 60)}${ok ? "" : `  期望=${check.expect instanceof RegExp ? check.expect : JSON.stringify(check.expect)}`}`);
  }
  // What 记为已投递 keeps: everything just filled must read back, under its label.
  const answers = [];
  for (const f of page.frames()) answers.push(...((await f.evaluate(`(${core.readFormAnswers.toString()})(${core.scanPageFields.toString()})`).catch(() => [])) || []));
  const answered = new Set(answers.map((a) => a.label.replace(/[\s*＊:：]/g, "")));
  const bare = (text) => String(text || "").split(" · ").pop().replace(/[\s*＊:：]/g, "");
  const filled = (result.details || []).filter((d) => ["profile", "memory", "ai"].includes(d.source) && !/需|手填/.test(d.state));
  const unread = filled.filter((d) => !answered.has(bare(d.label)) && ![...answered].some((label) => label.includes(bare(d.label)) || bare(d.label).includes(label)));
  // 逐段保存后表单变成了卡片，框已经不在页面上，读回这一项不适用。
  const readOk = !filled.length || !!options.saveBlocks || (filled.length - unread.length) / filled.length >= 0.85;
  checks = [...checks, { label: "记录读得回", expect: "x" }];
  if (readOk) pass++;
  lines.push(`  ${readOk ? "✓" : "✗"} 记录读得回          读回 ${filled.length - unread.length}/${filled.length} 个已填字段${unread.length ? `，没读回：${unread.slice(0, 6).map((d) => d.label).join("、")}` : ""}`);
  console.log(`\n=== ${name}  ${pass}/${checks.length} 通过  (${elapsed}ms) ===`);
  console.log(lines.join("\n"));
  console.log(`  结果: ${result.phase} · ${result.summary ? JSON.stringify(result.summary) : ""}`);
  if (process.env.LAB_VERBOSE) console.log(`  说明: ${result.message}\n  明细: ${JSON.stringify((result.details || []).map((d) => `${d.label}=${d.state}`))}`);
  if (process.env.VERBOSE) console.log("  消息:", result.message);
  console.log(`  交给 AI 的字段: ${aiQuestions.map((q) => `${q.label}(${q.kind})`).join("、") || "无"}`);
  const manual = (result.details || []).filter((d) => d.source === "manual").map((d) => `${d.label}:${d.state}`);
  console.log(`  标为需手填: ${manual.join("、") || "无"}`);
  if (errors.length) console.log("  页面报错:", errors.slice(0, 3).join(" | "));
  if (process.env.SHOT) await page.screenshot({ path: path.join(VENDOR, `${name}.png`), fullPage: true });
  await page.close();
  return { name, pass, total: checks.length };
}

const fv = (p) => `(() => { const v = window.__form.getFieldValue(${JSON.stringify(p)}); if (v == null) return ""; if (Array.isArray(v)) return v.map((x) => x && x.format ? x.format("YYYY-MM") : x).join(" ~ "); return v.format ? v.format("YYYY-MM-DD") : String(v); })()`;
const vm = (expr) => `(() => { const v = window.__vm.f${expr}; return Array.isArray(v) ? v.join("/") : String(v ?? ""); })()`;
const val = (sel) => `(document.querySelector(${JSON.stringify(sel)}) || {}).value || ""`;
const mk = (key) => `String((window.__state || {})[${JSON.stringify(key)}] ?? "")`;
const sel = (sel) => `(() => { const s = document.querySelector(${JSON.stringify(sel)}); return s && s.selectedIndex > 0 ? s.options[s.selectedIndex].text : ""; })()`;
const tip = (sel) => `(document.querySelector(${JSON.stringify(sel + " .phoenix-select__tipEle")}) || {}).textContent || ""`;
const radio = (name) => `(() => { const r = document.querySelector('input[name=${JSON.stringify(name)}]:checked'); return r ? (r.closest("label") ? r.closest("label").textContent : r.nextSibling.textContent).trim() : ""; })()`;
const shadow = (id, s = "input") => `document.getElementById(${JSON.stringify(id)}).shadowRoot.querySelector(${JSON.stringify(s)}).value`;

function v34Profile(p) {
  p.acceptAdjust = "接受";
  p.appliedJob = "数据分析师（2027届）";
  p.education[0].end = "2027-06";
  p.researchDirection = "因果推断与增长分析：基于观察数据估计营销干预的因果效应，并把结论用于用户增长策略的制定与评估。";
  p.awards = [...p.awards, { name: "国家奖学金", issuer: "教育部", level: "国家级", date: "2023-10", description: "" }];
  p.wechat = "zoe_lin_wx";
  p.selfIntro = "统计学硕士在读，研究方向是因果推断与增长分析。在字节跳动做过电商增长分析实习，搭建过 AB 实验看板。熟悉 SQL、Python 与 Tableau，能独立完成从取数到结论的分析。担任研究生会学术部部长，组织学术沙龙 12 场。做事认真细致，沟通顺畅。";
}

const suites = {
  "antd-moka": [[
    { label: "姓名", read: fv("name"), expect: "林晓舟" },
    { label: "手机号", read: fv("phone"), expect: "13812345678" },
    { label: "邮箱", read: fv("email"), expect: "linxz@example.invalid" },
    { label: "性别", read: fv("gender"), expect: "F" },
    { label: "出生日期", read: fv("birth"), expect: "2002-03-15" },
    { label: "政治面貌", read: fv("politics"), expect: "共青团员" },
    { label: "现居城市(级联)", read: fv("city"), expect: "shanghai ~ sh" },
    { label: "最高学历", read: fv("topDegree"), expect: "硕士" },
    { label: "教育1 学校", read: fv(["edu", 0, "school"]), expect: "复旦大学" },
    { label: "教育1 专业", read: fv(["edu", 0, "major"]), expect: "统计学" },
    { label: "教育1 学历", read: fv(["edu", 0, "degree"]), expect: "硕士研究生" },
    { label: "教育1 在校时间", read: fv(["edu", 0, "range"]), expect: "2024-09 ~ 2026-06" },
    { label: "实习 公司", read: fv(["exp", 0, "company"]), expect: "字节跳动" },
    { label: "实习 职位", read: fv(["exp", 0, "role"]), expect: "数据分析实习生" },
    { label: "实习 时间", read: fv(["exp", 0, "range"]), expect: "2025-06 ~ 2025-09" },
    { label: "实习 工作内容", read: fv(["exp", 0, "desc"]), expect: /抖音电商/ },
    { label: "是否服从调剂", read: fv("adjust"), expect: "1" },
    { label: "为什么选择", read: fv("why"), expect: /AI草稿/ },
    { label: "期望城市(多选)", read: fv("cities"), expect: "" },
    { label: "隐私同意", read: fv("agree"), expect: "" },
  ], { wait: 900 }],
  "element-beisen": [[
    { label: "姓名", read: vm(".name"), expect: "林晓舟", frame: "element-inner" },
    { label: "手机号码", read: vm(".phone"), expect: "13812345678", frame: "element-inner" },
    { label: "电子邮箱", read: vm(".email"), expect: "linxz@example.invalid", frame: "element-inner" },
    { label: "性别", read: vm(".gender"), expect: "2", frame: "element-inner" },
    { label: "出生年月(只读)", read: vm(".birth"), expect: "2002-03", frame: "element-inner" },
    { label: "民族", read: vm(".nation"), expect: "汉族", frame: "element-inner" },
    { label: "政治面貌", read: vm(".politics"), expect: "共青团员", frame: "element-inner" },
    { label: "籍贯(级联)", read: vm(".hometown"), expect: "js/nj", frame: "element-inner" },
    { label: "身份证号(不猜)", read: vm(".idno"), expect: "", frame: "element-inner" },
    { label: "教育1 学校", read: vm(".edu[0].school"), expect: "复旦大学", frame: "element-inner" },
    { label: "教育1 学历", read: vm(".edu[0].degree"), expect: "硕士", frame: "element-inner" },
    { label: "教育1 专业", read: vm(".edu[0].major"), expect: "统计学", frame: "element-inner" },
    { label: "教育1 入学", read: vm(".edu[0].start"), expect: "2024-09", frame: "element-inner" },
    { label: "教育1 毕业", read: vm(".edu[0].end"), expect: "2026-06", frame: "element-inner" },
    { label: "教育1 GPA", read: vm(".edu[0].gpa"), expect: "3.8/4.0", frame: "element-inner" },
    { label: "教育2 学校", read: vm(".edu[1].school"), expect: "南京大学", frame: "element-inner" },
    { label: "教育2 学历", read: vm(".edu[1].degree"), expect: "本科", frame: "element-inner" },
    { label: "教育2 入学", read: vm(".edu[1].start"), expect: "2020-09", frame: "element-inner" },
    { label: "家庭成员 姓名", read: vm(".fam.name"), expect: "", frame: "element-inner" },
    { label: "家庭成员 工作单位", read: vm(".fam.org"), expect: "", frame: "element-inner" },
    { label: "家庭成员 电话", read: vm(".fam.phone"), expect: "", frame: "element-inner" },
    { label: "紧急联系人姓名", read: vm(".emer.name"), expect: "", frame: "element-inner" },
    { label: "紧急联系人电话", read: vm(".emer.phone"), expect: "", frame: "element-inner" },
    { label: "自我评价", read: vm(".intro"), expect: /统计学硕士/, frame: "element-inner" },
  ], { wait: 1200 }],
  "dayee-table": [[
    { label: "姓名", read: val("[name=xm]"), expect: "林晓舟" },
    { label: "姓名拼音", read: val("[name=xmpy]"), expect: "" },
    { label: "性别(无label单选)", read: radio("xb"), expect: "女" },
    { label: "出生年", read: sel("[name=csn]"), expect: "2002" },
    { label: "出生月", read: sel("[name=csy]"), expect: "3" },
    { label: "证件号码", read: val("[name=zjhm]"), expect: "" },
    { label: "民族", read: sel("[name=mz]"), expect: "汉族" },
    { label: "移动电话", read: val("[name=sj]"), expect: "13812345678" },
    { label: "电子邮件", read: val("[name=yx]"), expect: "linxz@example.invalid" },
    { label: "固定电话", read: val("[name=gddh]"), expect: "" },
    { label: "政治面貌", read: sel("[name=zzmm]"), expect: "共青团员" },
    { label: "毕业院校", read: val("[name=byyx]"), expect: "复旦大学" },
    { label: "所学专业", read: val("[name=sxzy]"), expect: "统计学" },
    { label: "学历", read: sel("[name=xl]"), expect: "硕士研究生" },
    { label: "毕业时间", read: val("[name=bysj]"), expect: "2026-06-01" },
    { label: "外语水平", read: sel("[name=wy]"), expect: "大学英语六级" },
    { label: "外语成绩", read: val("[name=wycj]"), expect: /^(?:560)?$/ },
    { label: "紧急联系人姓名", read: val("[name=lxrxm]"), expect: "" },
    { label: "紧急联系人电话", read: val("[name=lxrdh]"), expect: "" },
    { label: "自我评价", read: val("[name=zwpj]"), expect: /统计学硕士/ },
    { label: "现居城市(个人及家庭)", read: val("[name=xjcs]"), expect: "上海" },
    { label: "父母姓名(不填)", read: val("[name=fmxm]"), expect: "" },
  ]],
  "workday-en": [[
    { label: "First Name", read: val("#fn"), expect: "" },
    { label: "Last Name", read: val("#ln"), expect: "" },
    { label: "English Name(存了英文名才填，不填中文名)", read: val("#en"), expect: "Zoe Lin" },
    { label: "Email", read: val("#em"), expect: "linxz@example.invalid" },
    { label: "Phone Device", read: sel("#pdt"), expect: /^(?:Mobile)?$/ },
    { label: "Country Code", read: sel("#cc"), expect: /^(?:China \(\+86\))?$/ },
    { label: "Phone Number", read: val("#ph"), expect: "13812345678" },
    { label: "Mailing Address", read: val("#ma"), expect: "" },
    { label: "City", read: val("#city"), expect: /^(?:上海|Shanghai)?$/ },
    { label: "Place of Birth", read: val("#pob"), expect: "" },
    { label: "Date of Birth", read: val("#dob"), expect: "2002-03-15" },
    { label: "Hear about us", read: "document.getElementById('hear').textContent.trim()", expect: "Company Website" },
    { label: "School", read: val("#sch"), expect: "复旦大学" },
    { label: "Degree", read: sel("#deg"), expect: "Master's Degree" },
    { label: "Field of Study", read: val("#fos"), expect: "统计学" },
    { label: "Edu From", read: val("#ef"), expect: "09/2024" },
    { label: "Edu To", read: val("#et"), expect: "06/2026" },
    { label: "GPA", read: val("#gpa"), expect: "3.8/4.0" },
    { label: "Job Title", read: val("#jt"), expect: "数据分析实习生" },
    { label: "Company", read: val("#co"), expect: "字节跳动" },
    { label: "Work From", read: val("#wf"), expect: "06/2025" },
    { label: "Work To", read: val("#wt"), expect: "09/2025" },
    { label: "Role Description", read: val("#rd"), expect: /抖音电商/ },
    { label: "Why interested", read: val("#q1"), expect: /AI草稿/ },
    { label: "Work authorized", read: sel("#q2"), expect: "Yes" },
    { label: "顶栏搜索框(不动)", read: val("#site-search"), expect: "" },
    { label: "语言切换(不动)", read: "document.getElementById('lang').textContent.trim()", expect: "English" },
  ]],
  // A dropdown showing its validation message is empty: not filled, and no answer for the record.
  "validation-msg": [[
    { label: "下拉照常填上", read: "(document.querySelector('#degree .ant-select-selection-item') || {}).textContent || ''", expect: "硕士" },
    { label: "提示不是答案", read: `(${core.readFormAnswers.toString()})(${core.scanPageFields.toString()}).filter((a) => /必填/.test(a.value)).length`, expect: "0" },
    { label: "搜索框不算题目", read: `(${core.scanPageFields.toString()})("lab-", true).filter((f) => /关键字/.test(f.placeholder || f.label || "")).length + "|" + document.querySelector("#job-search").value`, expect: "0|" },
    { label: "没选的不记", read: `(${core.readFormAnswers.toString()})(${core.scanPageFields.toString()}).filter((a) => a.label === "其他说明").length`, expect: "0" },
  ]],
  // A job page prints the job's name in its biggest type, above the duties.
  "jd-heading": [[
    { label: "最大字是岗位名", read: `(() => { ${viewSource.slice(viewSource.indexOf("function readJobPageInPage() {"), viewSource.indexOf("function scheduleJobPageCapture(tab) {"))}; return readJobPageInPage().headings[0]; })()`, expect: "星海控制算法工程师" },
    { label: "职责以下不算", read: `(() => { ${viewSource.slice(viewSource.indexOf("function readJobPageInPage() {"), viewSource.indexOf("function scheduleJobPageCapture(tab) {"))}; return readJobPageInPage().headings.includes("公司福利大标题"); })()`, expect: "false" },
    { label: "导航不算", read: `(() => { ${viewSource.slice(viewSource.indexOf("function readJobPageInPage() {"), viewSource.indexOf("function scheduleJobPageCapture(tab) {"))}; return readJobPageInPage().headings.includes("导航大字"); })()`, expect: "false" },
  ]],
  "custom-widgets": [[
    { label: "姓名(兄弟节点标签)", read: val("#w-name"), expect: "林晓舟" },
    { label: "手机(占位符)", read: val("#w-phone"), expect: "13812345678" },
    { label: "邮箱(只有占位符)", read: val("#w-email"), expect: "linxz@example.invalid" },
    { label: "性别(隐藏单选)", read: radio("sex"), expect: "女" },
    { label: "海外派遣(ARIA单选)", read: "(document.querySelector('#w-abroad [aria-checked=true]') || {}).textContent || ''", expect: "是" },
    { label: "出生日期(只读)", read: val("#w-birth"), expect: /^(?:2002-03-15)?$/ },
    { label: "毕业年", read: sel("#w-gy"), expect: "2026" },
    { label: "毕业月", read: sel("#w-gm"), expect: "06" },
    { label: "GPA(数字框)", read: val("#w-gpa"), expect: "3.8" },
    { label: "意向工作地点", read: val("#w-loc"), expect: "上海" },
    { label: "微信号", read: val("#w-wechat"), expect: "" },
    { label: "自我评价(富文本)", read: "document.getElementById('w-intro').innerText", expect: /统计学硕士/ },
    { label: "成就感问答", read: val("#w-q1"), expect: /AI草稿/ },
  ]],
  "shadow-dom": [[
    { label: "姓名", read: shadow("s-name"), expect: "林晓舟" },
    { label: "邮箱", read: shadow("s-email"), expect: "linxz@example.invalid" },
    { label: "手机", read: shadow("s-phone"), expect: "13812345678" },
    { label: "最高学历", read: `(() => { const s = document.getElementById("s-degree").shadowRoot.querySelector("select"); return s.selectedIndex > 0 ? s.options[s.selectedIndex].text : ""; })()`, expect: "硕士" },
    { label: "学校", read: shadow("s-school"), expect: "复旦大学" },
    { label: "专业", read: shadow("s-major"), expect: "统计学" },
  ]],
};

Object.assign(suites, {
  "antd-prefill": [[
    { label: "姓名(已有)", read: fv("name"), expect: "张三" },
    { label: "性别(已有)", read: fv("gender"), expect: "M" },
    { label: "政治面貌(已有)", read: fv("politics"), expect: "群众" },
    { label: "现居城市(已有)", read: fv("city"), expect: "guangdong ~ shenzhen" },
    { label: "手机号(补)", read: fv("phone"), expect: "13812345678" },
    { label: "教育1 学校(已有)", read: fv(["edu", 0, "school"]), expect: "南京大学" },
    { label: "教育1 专业(对齐本科)", read: fv(["edu", 0, "major"]), expect: "数学与应用数学" },
    { label: "教育1 学历(对齐本科)", read: fv(["edu", 0, "degree"]), expect: "本科" },
    { label: "教育1 时间(对齐本科)", read: fv(["edu", 0, "range"]), expect: "2020-09 ~ 2024-06" },
  ], { page: "antd-moka", query: "?prefill=1", wait: 900 }],
  "element-prefill": [[
    { label: "性别(已有)", read: vm(".gender"), expect: "1", frame: "element-inner" },
    { label: "民族(已有)", read: vm(".nation"), expect: "回族", frame: "element-inner" },
    { label: "政治面貌(已有)", read: vm(".politics"), expect: "中共党员", frame: "element-inner" },
    { label: "籍贯(已有)", read: vm(".hometown"), expect: "zj/hz", frame: "element-inner" },
    { label: "教育1 学校(已有)", read: vm(".edu[0].school"), expect: "南京大学", frame: "element-inner" },
    { label: "教育1 学历(对齐)", read: vm(".edu[0].degree"), expect: "本科", frame: "element-inner" },
    { label: "教育1 入学(对齐)", read: vm(".edu[0].start"), expect: "2020-09", frame: "element-inner" },
    { label: "教育2 学校(余下)", read: vm(".edu[1].school"), expect: "复旦大学", frame: "element-inner" },
    { label: "教育2 学历(余下)", read: vm(".edu[1].degree"), expect: "硕士", frame: "element-inner" },
  ], { page: "element-beisen", query: "?prefill=1", wait: 1200 }],
  "antd-expand": [[
    { label: "教育1 学校", read: fv(["edu", 0, "school"]), expect: "复旦大学" },
    { label: "教育2 学校(自动添加)", read: fv(["edu", 1, "school"]), expect: "南京大学" },
    { label: "教育2 学历", read: fv(["edu", 1, "degree"]), expect: "本科" },
    { label: "教育2 时间", read: fv(["edu", 1, "range"]), expect: "2020-09 ~ 2024-06" },
    { label: "实习 只有一段", read: "document.querySelectorAll('.block').length", expect: "3" },
  ], { page: "antd-moka", wait: 900, options: { expandBlocks: true } }],
  "semi-like": [[
    { label: "姓名", read: val("#nm"), expect: "林晓舟" },
    { label: "最高学历", read: "document.querySelector('#s-deg .semi-select-selection').textContent.trim()", expect: "硕士" },
    { label: "政治面貌(已有)", read: "document.querySelector('#s-pol .semi-select-selection').textContent.trim()", expect: "群众" },
    { label: "毕业院校(搜索)", read: "document.querySelector('#s-sch .semi-select-selection').textContent.trim()", expect: "复旦大学" },
    { label: "性别", read: "document.querySelector('#s-gen .semi-select-selection').textContent.trim()", expect: "女" },
  ]],
  "saved-cards": [[
    { label: "教育 下一段学校", read: val("#s"), expect: "南京大学" },
    { label: "教育 下一段专业", read: val("#m"), expect: "数学与应用数学" },
    { label: "教育 下一段学历", read: sel("#d"), expect: "本科" },
    { label: "教育 下一段入学", read: val("#st"), expect: "2020-09" },
    { label: "实习 全部已保存", read: val("#c"), expect: "" },
    { label: "实习 不重复第一段", read: val("#r"), expect: "" },
    { label: "校园经历 已保存，不重复", read: val("#k1"), expect: "" },
    { label: "校园职务 不重复", read: val("#k2"), expect: "" },
  ]],
  "header-row": [[
    { label: "奖励名称（标题在长表头里）", read: val("#an"), expect: "全国大学生数学建模竞赛一等奖" },
    { label: "已有获得时间不动", read: val("#ad"), expect: "2023-11" },
    { label: "颁奖机构", read: val("#ai"), expect: "中国工业与应用数学学会" },
  ], { options: { modules: ["award"] } }],
  "one-at-a-time": [[
    { label: "页头有名字，姓名照填", read: val("#n1"), expect: "林晓舟" },
    // 上面已保存 CET-6：空表单填下一门（雅思），不重复 CET-6。
    { label: "语种 下一门也是英语", read: sel("#l1"), expect: "英语" },
    { label: "语言等级 填下一门不重复", read: val("#l2"), expect: "雅思 7.0" },
    { label: "证书 换一条（AI 知道已保存）", read: val("#c1"), expect: "计算机二级证书" },
    { label: "颁发机构 跟着新的一条", read: val("#c2"), expect: "教育部考试中心" },
  ]],
  // 逐段自动保存：弹窗里的经历填好就点它自己的保存，接着加下一段。
  "modal-add": [[
    { label: "姓名", read: val("#n1"), expect: "林晓舟" },
    { label: "项目 两段都存了", read: `document.querySelectorAll("#project-list .card").length`, expect: "2" },
    { label: "项目1 内容", read: `document.querySelector("#project-list .card").textContent`, expect: /校园二手交易推荐系统.*负责人.*2025-03/ },
    { label: "项目2 是另一段", read: `document.querySelectorAll("#project-list .card")[1].textContent`, expect: /用户留存归因分析.*数据分析/ },
    { label: "获奖 三段都存了", read: `document.querySelectorAll("#award-list .card").length`, expect: "3" },
    { label: "获奖 没有重复", read: `new Set(Array.from(document.querySelectorAll("#award-list .card")).map((c) => c.textContent.split(" | ")[0])).size`, expect: "3" },
    { label: "弹窗都关了", read: `Array.from(document.querySelectorAll(".ant-modal-wrap")).filter((m) => m.style.display === "block").length`, expect: "0" },
    { label: "只点了 5 次保存", read: "window.__saves", expect: "5" },
    { label: "没碰提交申请", read: "String(!!window.__submitted)", expect: "false" },
    { label: "结果里说明存了几段", result: (r) => r.message, expect: /已替你逐段保存.*2 段项目经历.*3 段获奖情况/ },
  ], { options: { expandBlocks: true, saveBlocks: true }, profile: manyEntries }],
  "modal-add-required": [[
    { label: "必填项空着就不保存", read: `document.querySelectorAll("#project-list .card").length`, expect: "0" },
    { label: "弹窗留着等你补", read: `document.getElementById("project-modal").style.display`, expect: "block" },
    { label: "弹窗里已填好项目名称", read: `document.querySelector("[name=pname]").value`, expect: "校园二手交易推荐系统" },
    { label: "说明为什么没保存", result: (r) => r.message, expect: /指导老师工号」还空着，没替你保存/ },
    { label: "没碰提交申请", read: "String(!!window.__submitted)", expect: "false" },
  ], { page: "modal-add", query: "?strict", options: { expandBlocks: true, saveBlocks: true }, profile: manyEntries }],
  "modal-add-off": [[
    { label: "关掉逐段保存就只填不存", read: "window.__saves", expect: "0" },
    { label: "弹窗留着等你点保存", result: (r) => r.message, expect: /核对后点弹窗的保存/ },
  ], { page: "modal-add", options: { expandBlocks: true }, profile: manyEntries }],
  "save-next": [[
    { label: "获奖 三段都存了", read: `document.querySelectorAll("#award-list .card").length`, expect: "3" },
    { label: "获奖 没有重复", read: `new Set(Array.from(document.querySelectorAll("#award-list .card")).map((c) => c.textContent.split(" | ")[0])).size`, expect: "3" },
    { label: "空表单没有多填", read: val("#a1"), expect: "" },
    { label: "没碰保存并提交", read: "String(!!window.__submitted)", expect: "false" },
    { label: "结果里说明存了几段", result: (r) => r.message, expect: /已替你逐段保存 3 段获奖情况/ },
  ], { options: { expandBlocks: true, saveBlocks: true }, profile: manyEntries }],
  "one-at-a-time-fresh": [[
    { label: "第一条 语种", read: sel("#l1"), expect: "英语" },
    { label: "第一条 语言等级", read: val("#l2"), expect: "CET-6 560" },
    { label: "第一条 证书", read: val("#c1"), expect: "英语六级证书" },
  ], { page: "one-at-a-time", query: "?fresh" }],
  "campus": [[
    { label: "姓名", read: val("#b1"), expect: "林晓舟" },
    { label: "是否学生干部（来自校园经历）", read: `document.querySelector("#b2y").checked ? "是" : document.querySelector("#b2n").checked ? "否" : ""`, expect: "是" },
    { label: "学习成绩排名", read: val("#b3"), expect: "前 10%" },
    { label: "是否接受岗位调剂", read: sel("#b4"), expect: "是" },
    { label: "研究方向", read: val("#b5"), expect: "因果推断与增长分析" },
    { label: "主修课程", read: val("#b6"), expect: "多元统计分析、机器学习、时间序列" },
    { label: "教育 院系", read: val("#e2"), expect: "管理学院" },
    { label: "教育 专业", read: val("#e3"), expect: "统计学" },
    { label: "项目职务（标题挨着输入框）", read: val("#p2"), expect: "负责人" },
    { label: "校园 组织团体名称", read: val("#c1"), expect: "复旦大学研究生会" },
    { label: "校园 担任职务", read: val("#c2"), expect: "学术部部长" },
    { label: "校园 干部级别", read: sel("#c3"), expect: "校级" },
    { label: "校园 开始时间", read: val("#c4"), expect: "2024-09" },
    { label: "校园 结束时间", read: val("#c5"), expect: "2025-06" },
    { label: "校园 学生干部描述", read: val("#c6"), expect: "组织学术沙龙 12 场" },
  ]],
  "skills-v21": [[
    { label: "姓名", read: val("#b1"), expect: "林晓舟" },
    { label: "QQ号", read: val("#b2"), expect: "123456789" },
    { label: "个人主页链接", read: val("#b3"), expect: "https://github.com/linxz-example" },
    { label: "个人爱好", read: val("#b4"), expect: "摄影、羽毛球" },
    { label: "毕业论文题目", read: val("#b5"), expect: "基于因果推断的用户增长归因研究" },
    { label: "实验室", read: val("#b6"), expect: "统计学习实验室" },
    { label: "工作地是否可接受潍坊(不猜)", read: `document.querySelector("#b7y").checked || document.querySelector("#b7n").checked ? "选了" : ""`, expect: "" },
    { label: "教育 学校", read: val("#e1"), expect: "复旦大学" },
    { label: "是否211院校(不当学校)", read: `document.querySelector("#e3y").checked || document.querySelector("#e3n").checked ? "选了" : ""`, expect: "" },
    { label: "教育里的 受到奖励", read: val("#e4"), expect: /全国大学生数学建模竞赛一等奖/ },
    { label: "教育里的 校内活动", read: val("#e5"), expect: /复旦大学研究生会；学术部部长/ },
    { label: "单位名称(提示字下拉)", read: `document.querySelector("#x1 .shown").textContent`, expect: "字节跳动" },
    { label: "所在部门", read: val("#x2"), expect: "抖音电商数据组" },
    { label: "公司所属行业(不当公司)", read: sel("#x3"), expect: "" },
    { label: "职位名称", read: val("#x4"), expect: "数据分析实习生" },
    { label: "证明人单位(他人信息)", read: `document.querySelector("#x5 .shown").textContent`, expect: "输入证明人单位" },
    { label: "读回提示字=空", read: `(() => { const el = document.querySelector("#x5"); const id = el.getAttribute("data-cp-fill-id"); return JSON.stringify((${core.readFieldValues.toString()})([id])[id].value); })()`, expect: '""' },
    { label: "项目简述", read: val("#p2"), expect: "基于协同过滤的推荐系统" },
    { label: "项目 个人工作", read: val("#p3"), expect: "负责模型设计与评估" },
    { label: "技能1 名称", read: val("#s1"), expect: "Python" },
    { label: "技能1 掌握程度", read: sel("#s2"), expect: "熟练" },
    { label: "技能1 类别", read: sel("#s3"), expect: "编程语言" },
    { label: "技能2 名称", read: val("#s4"), expect: "Tableau" },
    { label: "技能2 熟悉→良好", read: sel("#s5"), expect: "良好" },
    { label: "技能2 类别", read: sel("#s6"), expect: "软件工具" },
    { label: "语种(英语)", read: sel("#l1"), expect: "英语" },
  ]],
  "languages-v22": [[
    { label: "姓名", read: val("#b1"), expect: "林晓舟" },
    { label: "IELTS(雅思分数)", read: val("#b2"), expect: "7.0" },
    { label: "托福成绩(没考不填)", read: val("#b3"), expect: "" },
    { label: "Country/region(英文)", read: sel("#b4"), expect: "China" },
    { label: "City(英文)", read: val("#b5"), expect: "Shanghai" },
    { label: "语言1 语种", read: sel("#l1"), expect: "英语" },
    { label: "语言1 考试类型", read: sel("#l2"), expect: "大学英语六级" },
    { label: "语言1 分数", read: val("#l3"), expect: "560" },
    { label: "语言1 考试时间", read: val("#l4"), expect: "2023-06" },
    { label: "语言2 语种", read: sel("#l5"), expect: "英语" },
    { label: "语言2 考试类型", read: sel("#l6"), expect: "雅思" },
    { label: "语言2 分数", read: val("#l7"), expect: "7.0" },
    { label: "语言2 考试时间", read: val("#l8"), expect: "2024-03" },
    { label: "是否担任学生干部", read: `document.querySelector("#c1y").checked ? "是" : document.querySelector("#c1n").checked ? "否" : ""`, expect: "是" },
    { label: "干部名称", read: val("#c2"), expect: "学术部部长" },
    { label: "干部层级", read: sel("#c3"), expect: "校级" },
    { label: "英文名", read: val("#e1"), expect: "Zoe Lin" },
    { label: "是否有交换生经历(无→否)", read: `document.querySelector("#x1y").checked ? "是" : document.querySelector("#x1n").checked ? "否" : ""`, expect: "否" },
  ]],
  "zhiye-awards": [[
    { label: "实践名称", read: val("#p1"), expect: "复旦大学研究生会" },
    { label: "担任职务", read: val("#p2"), expect: "学术部部长" },
    { label: "实践描述", read: val("#p3"), expect: "组织学术沙龙 12 场" },
    { label: "获奖项", read: val("#a1"), expect: "全国大学生数学建模竞赛一等奖" },
    { label: "获奖级别", read: sel("#a2"), expect: "国家级" },
    { label: "获奖时间", read: val("#a3"), expect: /^2023[-./年]?11/ },
    { label: "第二组获奖项(只存了一个奖，不重复)", read: val("#a4"), expect: "" },
  ]],
  // 曙光（北森 zhiye）：下拉的占位字「请选择」不能当标签；日历型下拉；多选不乱填；城市数量按提示。
  "zhiye-phoenix": [[
    { label: "期望工作地(只能一个城市)", read: val("#city1"), expect: "上海" },
    { label: "意向城市(最多2个,空格)", read: val("#city2"), expect: "上海 苏州" },
    { label: "单位名称", read: val("#exp-company"), expect: "字节跳动" },
    { label: "职位名称", read: val("#exp-role"), expect: "数据分析实习生" },
    { label: "工作职责(计数器0/2000不当标签)", read: val("#exp-desc"), expect: /抖音电商/ },
    { label: "手机号(区号按钮不当标签)", read: val("#phone"), expect: "13812345678" },
    { label: "开始时间(年月日历)", read: tip("#exp-start"), expect: "2025-06" },
    { label: "结束时间(年月日历)", read: tip("#exp-end"), expect: "2025-09" },
    { label: "奖项", read: val("#award-name"), expect: "全国大学生数学建模竞赛一等奖" },
    { label: "获奖级别(下拉)", read: tip("#award-level"), expect: "国家级" },
    { label: "获奖时间(完整日期日历)", read: tip("#award-date"), expect: "2023-11-01" },
    { label: "学历(已有值不动)", read: tip("#degree"), expect: "硕士" },
    { label: "意向行业(多选不乱填)", read: tip("#industry"), expect: "" },
    { label: "所在校区(读出选项交给AI选)", read: tip("#campus"), expect: "本部" },
    { label: "栏目传给AI", read: val("#club"), expect: "所在栏目=其他信息" },
    { label: "学习形式(非全日制排在前面)", read: tip("#study-mode"), expect: "全日制" },
    { label: "具体学制(二年制)", read: tip("#study-years"), expect: "二年制" },
  ], { profile: (p) => { p.preferredCities = "上海、苏州、杭州"; } }],
  "jd-meituan-v24": [[
    { label: "考试分数", read: val("#s1"), expect: "560" },
    { label: "语言考试成绩(考试名+分数)", read: val("#s2"), expect: "CET-6 560" },
    { label: "奖学金名称只取奖学金", read: val("#a1"), expect: "国家奖学金" },
    { label: "评优表彰名称只取荣誉称号", read: val("#a2"), expect: "校级优秀学生干部" },
    { label: "校园经历名称", read: val("#c1"), expect: "复旦大学研究生会" },
    { label: "校园经历角色", read: val("#c2"), expect: "学术部部长" },
    { label: "校园经历描述", read: val("#c3"), expect: "组织学术沙龙 12 场" },
    { label: "项目名称", read: val("#p1"), expect: "校园二手交易推荐系统" },
    { label: "项目链接", read: val("#p2"), expect: "https://github.com/linxz-example/recsys" },
    { label: "第二个项目没有就不填", read: val("#p4"), expect: "" },
  ], { profile: (p) => {
    p.awards = [...p.awards, { name: "国家奖学金", issuer: "教育部", level: "国家级", date: "2023-10", description: "" }, { name: "校级优秀学生干部", issuer: "", level: "校级", date: "2023-12", description: "" }];
    p.projects[0].link = "https://github.com/linxz-example/recsys";
  } }],
  "feishu-ud": [[
    { label: "姓名", read: val("#name"), expect: "林晓舟" },
    { label: "邮箱", read: val("#email"), expect: "linxz@example.invalid" },
    { label: "年龄(由出生日期算)", read: val("#age"), expect: /^2[3-9]$/ },
    { label: "性别(下拉)", read: `document.querySelector("#gender-sel .ud__select__selector__selectItem").textContent`, expect: "女" },
    { label: "学校", read: val("#school"), expect: "复旦大学" },
    { label: "专业", read: val("#major"), expect: "统计学" },
    { label: "起止时间 开始", read: val("#start"), expect: /^2024[-./年]?0?9/ },
    { label: "起止时间 结束", read: val("#end"), expect: /^2026[-./年]?0?6/ },
    { label: "学历(下拉)", read: `document.querySelector("#degree-sel .ud__select__selector__selectItem").textContent`, expect: "硕士" },
    { label: "社交平台1(下拉)", read: `document.querySelector("#sns1-sel .ud__select__selector__selectItem").textContent`, expect: "微信" },
    { label: "URL/ID 1 = 微信号", read: val("#sns1-id"), expect: "zoe_lin_wx" },
    { label: "社交平台2(下拉)", read: `document.querySelector("#sns2-sel .ud__select__selector__selectItem").textContent`, expect: "QQ" },
    { label: "URL/ID 2 = QQ 号", read: val("#sns2-id"), expect: "123456789" },
  ], { wait: 800, profile: (p) => { p.wechat = "zoe_lin_wx"; } }],
  "aria-date": [[
    { label: "项目名称", read: val("#n0"), expect: "校园二手交易推荐系统" },
    { label: "职务", read: val("#j0"), expect: "负责人" },
    { label: "开始时间(隐藏原生日期框)", read: val("#d0-start_date"), expect: "2025-03-01" },
    { label: "开始时间 分段跟着变", read: `document.querySelector("#field-error-project-0-start_date [data-type=month]").textContent`, expect: "3" },
    { label: "结束时间", read: val("#d0-end_date"), expect: "2025-06-01" },
    { label: "项目描述", read: val("#x0"), expect: /协同过滤/ },
    { label: "第二项没有资料不乱填", read: val("#d1-start_date"), expect: "" },
  ]],
  "antd-tree": [[
    { label: "现居城市(不可搜索，逐级展开)", read: fv("city"), expect: "sh" },
    { label: "籍贯 江苏南京(可搜索)", read: fv("hometown"), expect: "nj" },
  ], { wait: 600 }],
  // 海康威视个人中心：只读展示，先点「编辑」才有输入框，一次只能开一栏；栏目标题里带「必填」和长提示。
  "hik-view-edit": [[
    { label: "姓名(自动点开个人信息)", read: val("#name"), expect: "林晓舟" },
    { label: "邮箱", read: val("#email"), expect: "linxz@example.invalid" },
    { label: "意向工作地自填框", read: val("#workwill"), expect: "上海 苏州" },
    { label: "QQ", read: val("#qq"), expect: "123456789" },
    { label: "保存后再填:教育开始", read: val("#eduStart"), expect: "2024-09" },
    { label: "教育结束", read: val("#eduEnd"), expect: "2026-06" },
    { label: "研究方向", read: val("#research"), expect: "因果推断与增长分析" },
    { label: "填了自填框就选「自填」", read: radio("workwill_addr_type"), expect: "自填" },
    { label: "提示写在结果栏上", result: (r) => (r.summary?.notes || []).join("|"), expect: /已点开「教育经历」的「编辑」/ },
  ], { profile: (p) => { p.preferredCities = "上海、苏州"; }, between: async (page) => {
    const opened = await page.evaluate(`[document.querySelector("#m-basic .edit_form").style.display, document.querySelector("#m-edu .edit_form").style.display].join("/")`);
    await page.click("#m-basic .save");
    return `第一次填写后 个人信息/教育经历 表单显示=${opened}`;
  } }],
  // 2026-10-31 的蔚来 / 千寻（飞书招聘）、国机、猎聘：只选年份的获奖时间、是否题、空着只有「添加」的社交账号 / 自我评价、
  // 网站自己解析简历填错了学历、单行研究方向要短的、字数上限、学生干部 / 奖学金 / 国籍 / 学习形式。
  "feishu-v34": [[
    { label: "是否接受调剂(资料写接受)", read: val("#adjust"), expect: "是" },
    { label: "全日制在校(标签被截成…)", read: `document.querySelector("#fulltime-sel .ud__select__selector__selectItem").textContent`, expect: "是" },
    { label: "国籍", read: sel("#nation"), expect: "中国大陆" },
    { label: "带编号的投递岗位", read: val("#job"), expect: "数据分析师（2027届）" },
    { label: "工作年限(在读选应届生)", read: sel("#years"), expect: "应届生" },
    { label: "成绩(4字框只填分数)", read: val("#edu-gpa"), expect: "3.7" },
    { label: "研究方向(单行框用简短的)", read: val("#topic"), expect: "因果推断与增长分析" },
    { label: "专业描述(长框用整段)", read: val("#topic-long"), expect: /^因果推断与增长分析：基于观察数据/ },
    { label: "学生干部情况", read: val("#cadre"), expect: /学术部部长/ },
    { label: "奖学金情况(只要奖学金)", read: val("#scholar"), expect: /^(?!.*数学建模).*国家奖学金/ },
    { label: "解析错学历的那段仍补专业", read: val("#edu-major"), expect: "数学与应用数学" },
    { label: "页面已有的学历不改", read: sel("#edu-degree"), expect: "硕士" },
    { label: "学习形式", read: sel("#edu-mode"), expect: "全日制" },
    { label: "教育形式(不选非全日制)", read: sel("#edu-kind"), expect: "统招全日制" },
    { label: "获奖1 名称", read: val("#award1-name"), expect: "全国大学生数学建模竞赛一等奖" },
    { label: "获奖1 年份(ud)", read: val("#award1-date"), expect: "2023" },
    { label: "获奖2 名称", read: val("#award2-name"), expect: "国家奖学金" },
    { label: "获奖2 年份(atsx)", read: val("#award2-date"), expect: "2023" },
    { label: "社交账号1 平台(点添加)", read: `(document.querySelector("#sns1-sel .ud__select__selector__selectItem") || {}).textContent || ""`, expect: "微信" },
    { label: "社交账号1 ID", read: val("#sns1-id"), expect: "zoe_lin_wx" },
    { label: "社交账号2 平台", read: `(document.querySelector("#sns2-sel .ud__select__selector__selectItem") || {}).textContent || ""`, expect: "QQ" },
    { label: "社交账号2 ID", read: val("#sns2-id"), expect: "123456789" },
    { label: "自我评价(点添加、按120字截整句)", read: `(() => { const v = (document.querySelector("#self-text") || {}).value || ""; return v.length <= 120 && v.endsWith("。") && v.startsWith("统计学硕士在读") ? "ok" : v.length + ":" + v; })()`, expect: "ok" },
    { label: "结果栏:截短了", result: (r) => (r.summary?.notes || []).join("|"), expect: /按网页字数上限截短/ },
    { label: "结果栏:学历和资料不同", result: (r) => (r.summary?.notes || []).join("|"), expect: /学历.*硕士.*本科/ },
  ], { options: { expandBlocks: true }, profile: v34Profile }],
  // 自动补齐栏目关着：空栏目不点，结果栏给出「补齐栏目再填」。
  "feishu-v34-off": [[
    { label: "不点添加", read: `String(document.querySelectorAll("#sns .sel").length)`, expect: "0" },
    { label: "结果栏列出空栏目", result: (r) => (r.summary?.expandable || []).join("、"), expect: "社交账号、自我评价" },
  ], { page: "feishu-v34", options: { expandBlocks: false }, profile: v34Profile }],
  "zhiye-v37": [[
    { label: "目前职位(在读写学生)", read: val("#position"), expect: "学生" },
    { label: "推荐方式选无", read: radio("refer"), expect: "无" },
    { label: "学校联想框:点选列表里的学校", read: val("#school1"), expect: "复旦大学" },
    { label: "学校联想框:列表里没有就不乱选", read: val("#school2"), expect: "" },
    { label: "成绩排名按档位", read: sel("#rank1"), expect: "前 20%" },
    { label: "工作经历被网站占了,实习经历仍填第一段", read: val("#intern-company"), expect: "字节跳动" },
    { label: "实习职位", read: val("#intern-role"), expect: "数据分析实习生" },
    { label: "网站已填的工作经历不动", read: val("#work1-company"), expect: "某某智能科技" },
    { label: "在校职务:职务名称", read: val("#duty-name"), expect: "学术部部长" },
    { label: "在校职务:职务描述是描述", read: val("#duty-desc"), expect: "组织学术沙龙 12 场" },
    { label: "语言类型", read: sel("#lang"), expect: "英语" },
    { label: "掌握程度(六级560)", read: sel("#lang-level"), expect: "熟练" },
    { label: "听说", read: sel("#lang-listen"), expect: "熟练" },
    { label: "读写", read: sel("#lang-write"), expect: "熟练" },
    { label: "精通程度(飞书说法)", read: sel("#lang-feishu"), expect: "商务会话" },
    { label: "没选上的学校报给用户", result: (r) => (r.details || []).filter((d) => d.source === "manual").map((d) => `${d.label}:${d.state}`).join("|"), expect: /学校名称:网站的下拉列表里没有「南京大学」/ },
  ], { profile: (p) => { p.education[0].end = "2027-06"; p.educationEnd = "2027-06"; p.rank = "前15%"; } }],
  "feishu-v40": [[
    { label: "获奖1 名称", read: val("#award1-name"), expect: "全国大学生数学建模竞赛一等奖" },
    { label: "获奖1 年份(ud 日期框要提交)", read: val("#award1-date"), expect: "2023" },
    { label: "获奖2 年份(资料写 2023.5.20)", read: val("#award2-date"), expect: "2023" },
    { label: "出生日期(ud 年月)", read: val("#birth"), expect: "2002-03" },
    { label: "姓名(后面的框改动不冲掉日期)", read: val("#name"), expect: "林晓舟" },
  ], { profile: (p) => { p.awards = [...p.awards, { name: "校级优秀学生干部", issuer: "", level: "校级", date: "2023.5.20", description: "" }]; } }],
  "moka-v49": [[
    { label: "姓名", read: val("#name"), expect: "林晓舟" },
    { label: "性别(sd-Select 要点选)", read: mk("gender"), expect: "女" },
    { label: "工作经验(不是经历，是选项)", read: mk("work"), expect: "应届毕业生" },
    { label: "最高学历", read: mk("top"), expect: "硕士" },
    { label: "所在地", read: val("#city"), expect: "上海" },
    { label: "出生日期(月份日历)", read: val("#birth"), expect: /^2002-03/ },
    { label: "籍贯(省市面板+确认)", read: val("#home"), expect: "江苏 南京市" },
    { label: "就读 开始年", read: mk("edu0.start.y"), expect: "2024" },
    { label: "就读 开始月(网站先设成 1)", read: mk("edu0.start.m"), expect: "9" },
    { label: "就读 结束年", read: mk("edu0.end.y"), expect: "2027" },
    { label: "就读 结束月", read: mk("edu0.end.m"), expect: "6" },
    { label: "学校(联网搜索后点选)", read: mk("school0"), expect: "复旦大学" },
    { label: "专业(列表没有时点添加)", read: mk("major0"), expect: "统计学·因果方向" },
    { label: "学历", read: mk("degree0"), expect: "硕士" },
    { label: "学历类型(不是学历本身)", read: mk("type0"), expect: "全日制" },
    { label: "成绩排名(看到选项后重配)", read: mk("rank0"), expect: "前10%" },
    { label: "实习 开始", read: mk("exp0.start.y"), expect: "2024" },
    { label: "实习 开始月", read: mk("exp0.start.m"), expect: "11" },
    { label: "实习 至今(勾选)", read: mk("exp0.now"), expect: "true" },
    { label: "获奖 年", read: mk("award0.y"), expect: "2023" },
    { label: "获奖 月", read: mk("award0.m"), expect: "11" },
  ], { profile: (p) => { p.educationEnd = "2027-06"; p.education[0].end = "2027-06"; p.education[0].major = "统计学·因果方向"; p.major = "统计学·因果方向"; p.experiences = [{ company: "美团", department: "", role: "实习生", start: "2024-11", end: "至今", description: "" }]; } }],
  "soe-v49": [[
    { label: "入党时间", read: val("#party"), expect: "2021-06" },
    { label: "户籍所在地(不是籍贯)", read: val("#household"), expect: "江苏省南京市鼓楼区" },
    { label: "生源地", read: val("#source"), expect: "江苏南京" },
    { label: "身高", read: val("#height"), expect: "168" },
    { label: "婚姻状况", read: sel("#marital"), expect: "未婚" },
    { label: "健康状况", read: val("#health"), expect: "良好" },
    { label: "亲属在本公司", read: val("#relative"), expect: "无" },
    { label: "父亲姓名", read: val("#father"), expect: "林建国" },
    { label: "母亲工作单位", read: val("#mother-job"), expect: "南京市第一中学" },
    { label: "导师姓名", read: val("#advisor"), expect: "王教授" },
    { label: "陌生下拉(点开看新冒出的列表)", read: `window.__degree || ""`, expect: "硕士" },
    { label: "飞书树形下拉 所在地点", read: `(window.__tree || {})["tree-one"] || ""`, expect: "新加坡" },
    { label: "飞书树形下拉 家乡(下面还有区县)", read: `(window.__tree || {})["tree-home"] || ""`, expect: "天津" },
    { label: "飞书树形多选 期望工作地点", read: `(window.__tree || {})["tree-many"] || ""`, expect: "上海 南京" },
    { label: "紧急联系人 姓名", read: val("#em-name"), expect: "林建国" },
    { label: "紧急联系人 关系", read: val("#em-rel"), expect: "父亲" },
    { label: "紧急联系人 电话", read: val("#em-phone"), expect: "13900000000" },
    { label: "家庭 第1行 称谓", read: val("#f0-rel"), expect: "父亲" },
    { label: "家庭 第1行 单位", read: val("#f0-emp"), expect: "南京电力公司" },
    { label: "家庭 第2行 姓名", read: val("#f1-name"), expect: "陈芳" },
    { label: "家庭 第2行 职务", read: val("#f1-pos"), expect: "教师" },
  ], { profile: (p) => { Object.assign(p, { partyDate: "2021-06", householdPlace: "江苏省南京市鼓楼区", sourcePlace: "江苏南京", height: "168", marital: "未婚", health: "良好", relativeInCompany: "无", advisor: "王教授", currentCity: "新加坡", hometown: "天津", preferredCities: "上海,南京", emergencyName: "林建国", emergencyRelation: "父亲", emergencyPhone: "13900000000", family: [{ relation: "父亲", name: "林建国", birthDate: "1970-05", politics: "群众", employer: "南京电力公司", position: "工程师", phone: "" }, { relation: "母亲", name: "陈芳", birthDate: "1972-01", politics: "群众", employer: "南京市第一中学", position: "教师", phone: "" }] }); p.degree = "硕士"; } }],
  "beisen-v50": [[
    { label: "姓名(后面的框在重建后还能填)", read: mk("name"), expect: "林晓舟" },
    { label: "第一段 学校", read: mk("s0"), expect: "复旦大学" },
    { label: "第一段 开始(月份日历)", read: mk("s0.from"), expect: "2024-09" },
    { label: "第一段 结束", read: mk("s0.to"), expect: "2026-06" },
    { label: "第一段 学历", read: mk("d0"), expect: "硕士研究生" },
    { label: "第二段 学校", read: mk("s1"), expect: "南京大学" },
    { label: "第二段 开始(不写到第一段)", read: mk("s1.from"), expect: "2020-09" },
    { label: "第二段 结束", read: mk("s1.to"), expect: "2024-06" },
    { label: "第二段 学历(不点到旧列表)", read: mk("d1"), expect: "本科" },
    { label: "工作 公司", read: mk("c0"), expect: "字节跳动" },
    { label: "工作 开始(只有一段时同属第一行)", read: mk("c0.from"), expect: "2025-06" },
    { label: "工作 结束(下拉比输入框深一层)", read: mk("c0.to"), expect: "2025-09" },
    { label: "城市框(勾选+确定，多个城市)", read: mk("cities"), expect: "上海市 南京市" },
  ], { wait: 300, profile: (p) => { p.preferredCities = "上海,南京,火星"; p.experiences = [...p.experiences, { company: "美团", department: "", role: "实习生", start: "2024-11", end: "2025-02", description: "" }]; } }],
  "win-51job": [[
    { label: "最高学历", read: sel("#top"), expect: "硕士" },
    { label: "学历类型(全日制)", read: sel("#type"), expect: "全日制" },
    { label: "毕业时间", read: val("#grad"), expect: "2026-06" },
    { label: "毕业学校 省份", read: sel("#s-prov"), expect: "上海" },
    { label: "毕业学校 学校", read: sel("#s-school"), expect: "复旦大学" },
    { label: "其他学校(选上了就空着)", read: val("#s-other"), expect: "" },
    { label: "专业 第二级", read: sel("#m-major"), expect: "统计学" },
    { label: "本科学历类型", read: sel("#b-type"), expect: "全日制" },
    { label: "本科毕业时间(本科那段)", read: val("#b-grad"), expect: "2024-06" },
    { label: "本科毕业学校 省份", read: sel("#b-prov"), expect: "江苏省" },
    { label: "本科毕业学校 学校", read: sel("#b-school"), expect: "南京大学" },
    { label: "本科专业 第二级", read: sel("#b-major"), expect: "数学与应用数学" },
  ]],
  "win-moka": [[
    { label: "硕士 学校", read: val("#e0-school"), expect: "复旦大学" },
    { label: "硕士 学历", read: sel("#e0-deg"), expect: "硕士" },
    { label: "本科一段 学校", read: val("#u-school"), expect: "南京大学" },
    { label: "本科一段 专业", read: val("#u-major"), expect: "数学与应用数学" },
    { label: "本科一段 学历", read: sel("#u-deg"), expect: "本科" },
    { label: "项目 职责(短框=角色)", read: val("#p-role"), expect: "负责人" },
    { label: "项目中职责(长框)", read: val("#p-duty"), expect: "负责模型设计与评估" },
    { label: "项目描述", read: val("#p-desc"), expect: "基于协同过滤的推荐系统" },
  ]],
  "win-study": [[
    { label: "个人信息 学习形式", read: sel("#mode"), expect: "全日制" },
    { label: "教育 学历", read: sel("#z-deg"), expect: "硕士研究生" },
    { label: "具体学制(按起止算)", read: sel("#z-years"), expect: "2年" },
    { label: "教育 学习形式", read: sel("#z-mode"), expect: "全日制" },
    { label: "受教育类型", read: sel("#z-edu-type"), expect: "统招全日制" },
    { label: "是否全日制", read: sel("#z-full"), expect: "是" },
  ]],
  "win-bili": [[
    { label: "姓名", read: mk("name"), expect: "林晓舟" },
    { label: "出生日期(只读框+弹出日历)", read: mk("birth"), expect: "2002-03-15" },
    { label: "学校", read: mk("school"), expect: "复旦大学" },
    { label: "开始(月份日历)", read: mk("from"), expect: "2024-09" },
    { label: "结束(至)", read: mk("to"), expect: "2026-06" },
    { label: "学历(老版选择框)", read: mk("degree"), expect: "硕士" },
    { label: "是否全日制(选项是 全日制/非全日制)", read: mk("full"), expect: "全日制" },
    { label: "学习形式(不选非全日制)", read: mk("mode"), expect: "全国普通高等院校全日制" },
    { label: "学校所在国家/地区(按学校)", read: mk("country"), expect: "中国" },
    { label: "英语水平", read: mk("english"), expect: "大学英语六级" },
    { label: "六级成绩(选了才出来，分数段)", read: mk("cet6"), expect: "550-710" },
  ], { wait: 600, profile: (p) => { p.english = "CET-6 560"; p.languages = [{ name: "CET-6", language: "英语", score: "560", date: "2023-06" }]; p.currentCity = "新加坡"; } }],
  "wizard": [[
    { label: "第1步 姓名", read: val("#a1"), expect: "林晓舟" },
    { label: "第1步 性别", read: sel("#a4"), expect: "女" },
    { label: "第2步 学校", read: val("#b1"), expect: "复旦大学" },
    { label: "第2步 专业", read: val("#b2"), expect: "统计学" },
    { label: "第2步 学历", read: sel("#b3"), expect: "硕士" },
    { label: "第2步 入学", read: val("#b4"), expect: "2024-09" },
    { label: "第2步 毕业", read: val("#b5"), expect: "2026-06" },
  ], { between: async (page) => {
    const before = await page.evaluate(`(${core.countFillableFields.toString()})(${core.scanPageFields.toString()})`);
    await page.click("#next");
    await page.waitForTimeout(200);
    const after = await page.evaluate(`(${core.countFillableFields.toString()})(${core.scanPageFields.toString()})`);
    return `第1页剩余可填 ${before.count}，翻页后检测到 ${after.count} 个可填字段，签名${before.signature === after.signature ? "未变（错误）" : "已变"}`;
  } }],
  "zhiye-v67": [[
    { label: "手机号(+86旁)", read: val("#zy-phone"), expect: "13812345678" },
    { label: "最高学位(学士)", read: sel("#zy-top-degree"), expect: "硕士" },
    { label: "意向城市(江苏南京->南京)", read: tip("#zy-city"), expect: "南京" },
    { label: "在校职务名称", read: val("#zy-campus-role"), expect: "学术部部长" },
    { label: "在校开始时间", read: val("#zy-campus-start"), expect: "2024-09" },
    { label: "在校结束时间", read: val("#zy-campus-end"), expect: "2025-06" },
  ], { profile: (p) => { p.preferredCities = "江苏南京"; } }],
  "feishu-atsx": [[
    { label: "学校(.atsx-select异步搜索)", read: `(document.querySelector("#fx-school-wrap .atsx-select-selection-selected-value") || {}).textContent || ""`, expect: "复旦大学" },
    { label: "学历(.atsx-select学士学位匹配)", read: `(document.querySelector("#fx-deg-wrap .atsx-select-selection-selected-value") || {}).textContent || ""`, expect: "硕士研究生" },
    { label: "教育开始(period-month)", read: val("#fx-start"), expect: "2024-09" },
    { label: "教育结束(period-month)", read: val("#fx-end"), expect: "2026-06" },
    { label: "公司名称", read: val("#fx-company"), expect: "字节跳动" },
    { label: "工作开始(至+atsx日历)", read: val("#fx-work-start"), expect: "2025-06" },
    { label: "工作结束(至+atsx日历)", read: val("#fx-work-end"), expect: "2025-09" },
  ]],
  "upload-and-inline-cards": [[
    { label: "亲属在本公司(合规问题)", read: sel("#rel-co"), expect: "否" },
    { label: "紧急联系人不填本人", read: val("#emg-name"), expect: "" },
    { label: "证件照识别(跳过上传附件按钮文)", read: `(() => { (${core.markTypedFileInputs.toString()})(["photo"]); return document.getElementById("photo-file").getAttribute("data-cp-upload-role") || ""; })()`, expect: "photo" },
    { label: "简历上传识别(主简历)", read: `(() => { (${core.markResumeFileInputs.toString()})("cp-r"); return document.getElementById("resume-file").getAttribute("data-cp-resume-upload") || ""; })()`, expect: "1" },
    { label: "单表单卡片自动连存2段项目", read: `Array.from(document.querySelectorAll("#saved-projects .proj-card")).map((n) => n.textContent.trim()).join(" | ")`, expect: /校园二手交易推荐系统.*用户留存归因分析/ },
  ], { options: { saveBlocks: true }, profile: (p) => { p.relativeInCompany = "无"; manyEntries(p); } }],
});

const browser = await chromium.launch({ headless: true });
const totals = [];
for (const [name, [checks, opts]] of Object.entries(suites)) {
  if (only.length && !only.includes(name)) continue;
  try { totals.push(await runPage(browser, name, checks, opts)); }
  catch (e) { console.log(`\n=== ${name} 运行失败: ${e.stack}`); }
}
const passed = totals.reduce((a, t) => a + t.pass, 0);
const total = totals.reduce((a, t) => a + t.total, 0);
console.log("\n汇总:", totals.map((t) => `${t.name} ${t.pass}/${t.total}`).join(" · "), `= ${passed}/${total}`);
await browser.close();
server.closeAllConnections?.();
server.close();
process.exit(passed === total && totals.length ? 0 : 1);
