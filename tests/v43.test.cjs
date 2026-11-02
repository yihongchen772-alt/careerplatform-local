const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require, console });
  return mod.exports;
}
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const city = load("src/lib/application-city.ts");

// Synthetic text in the shapes 飞书 and Moka job pages use.
test("飞书's 城市+校招/正式 line and Moka's pay|place|degree line give the job's city", () => {
  const cases = [
    ["首页\n职位\n登录\n结构工程师-苏州\n苏州校招正式硬件 / 结构\n职位描述\n…", ["苏州"]],
    ["示例科技校招官网\n登录\n嵌入式软件工程师\n杭州正式软件类\n职位描述", ["杭州"]],
    ["首页\n测试工程师\n北京、上海校招正式测试类\n职位描述", ["北京", "上海"]],
    ["运营管培生\n广州实习运营类\n职位描述", ["广州"]],
    ["登录\n27届-视觉算法工程师\n分享\n15 - 30 K/月|浙江·宁波市|硕士\n申请职位\n职位描述", ["宁波"]],
  ];
  for (const [text, expected] of cases) assert.deepEqual(plain(city.cityFromJobText(text)), expected, text);
  // A company or a heading that only starts with a city is not a place line.
  assert.deepEqual(plain(city.cityFromJobText("首页\n上海电气集团校招正式启动\n职位描述")), []);
  assert.deepEqual(plain(city.cityFromJobText("首页\n校园招聘\n社会招聘\n实习生招聘\n职位描述")), []);
});

test("记为已投递 fills the city from the page, the title, then the job pages the tab went through", () => {
  const dialog = read("src/components/browser/mark-applied-from-browser.tsx");
  assert.match(dialog, /cityFromSubmission\(snapshot\.fields[\s\S]*cityFromJobText\(snapshot\.text\)[\s\S]*citiesInTitle\(jobTitle\)[\s\S]*cityForSubmittedJob\(/);
  // Only when the page is this job's, and never over a city the applicant typed.
  assert.match(dialog, /pageShowsTitle\(snapshot\.text, jobTitle\)/);
  assert.match(dialog, /touched\.current\.city \|\| !cities\.length/);
  const action = read("src/lib/actions/city-lookup.ts");
  assert.match(action, /export async function cityForSubmittedJob[\s\S]*?requireUser\(\)[\s\S]*?filter\(isJobPageUrl\)[\s\S]*?pageShowsTitle\(text, title\)/);
});
