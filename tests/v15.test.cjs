const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");
const core = require("../electron/autofill-core.js");

// v1.15: 测评截止 from mail, quieter 待核对, the morning mail's schedule,
// 自动读邮件停了, 投递成功 mail → a 投递, 小欧's 找岗位, and filling the next
// 经历 when the saved ones are cards.

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Buffer, URL, process, setTimeout, clearTimeout, Response, Request, Headers });
  return mod.exports;
}
const noDb = { "@/lib/db": { db: {} } };

test("autofill: saved 经历 cards on the page are skipped, the empty form gets the next record", () => {
  const profile = { experiences: [
    { company: "字节跳动", role: "产品实习生", start: "2024-06", end: "2024-09", description: "A" },
    { company: "美团", role: "数据分析实习生", start: "2025-01", end: "2025-04", description: "B" },
    { company: "腾讯", role: "运营实习生", start: "2025-06", end: "2025-08", description: "C" },
  ] };
  const field = (id, label) => ({ id, blockKey: "new", label, section: "实习经历", tag: "input" });
  const fields = [field("company", "公司名称"), field("role", "职位名称")];
  const card = "实习经历\n字节跳动 | 产品实习生\n2024.06 - 2024.09\n编辑 删除\n+ 添加实习经历";
  const { repeats, rowIndexes } = core.classifyRepeatBlocks(fields, profile, card);
  assert.equal(core.repeatFieldValue(fields[0], repeats.get("company"), profile), "美团");
  assert.equal(core.repeatFieldValue(fields[1], repeats.get("role"), profile), "数据分析实习生");
  // Saved cards count as shown: 3 saved, 1 card + 1 form → one more to add.
  assert.deepEqual(core.missingRepeatCounts(profile, rowIndexes).map((item) => item.shown), [2]);
  // Two saved already: the third.
  const two = core.classifyRepeatBlocks(fields, profile, `${card}\n美团 数据分析实习生 2025-01 至 2025-04`);
  assert.equal(core.repeatFieldValue(fields[0], two.repeats.get("company"), profile), "腾讯");
  // All saved: nothing to fill, never the first one again.
  const all = core.classifyRepeatBlocks(fields, profile, `${card}\n美团 数据分析实习生\n腾讯 运营实习生`);
  assert.equal(core.repeatFieldValue(fields[0], all.repeats.get("company"), profile), null);
  assert.equal(core.missingRepeatCounts(profile, all.rowIndexes).length, 0);
  // A company name alone (a header, an ad) is not a saved card.
  const loose = core.classifyRepeatBlocks(fields, profile, "欢迎来到字节跳动校园招聘");
  assert.equal(core.repeatFieldValue(fields[0], loose.repeats.get("company"), profile), "字节跳动");
  // No page text: unchanged.
  assert.equal(core.repeatFieldValue(fields[0], core.classifyRepeatBlocks(fields, profile).repeats.get("company"), profile), "字节跳动");
  // A block on the page holding a record in its inputs is not also a card.
  const filled = [{ ...field("c0", "公司名称"), blockKey: "a", hasValue: true, currentValue: "字节跳动" }, { ...field("c1", "公司名称"), blockKey: "b" }];
  const both = core.classifyRepeatBlocks(filled, profile, card);
  assert.equal(core.repeatFieldValue(filled[1], both.repeats.get("c1"), profile), "美团");
  // The same school twice (本科 + 硕士) is told apart by major only.
  const edu = { education: [{ school: "复旦大学", degree: "本科", major: "经济学", start: "2019-09" }, { school: "复旦大学", degree: "硕士", major: "金融", start: "2023-09" }] };
  assert.deepEqual([...core.savedRecordsOnPage(edu, "复旦大学 本科 2019-09").get("education") || []], []);
  const found = [...core.savedRecordsOnPage(edu, "复旦大学 本科 经济学 2019.09-2023.06").get("education")];
  assert.deepEqual(found.map((index) => core.rowsForGroup(edu, "education")[index].major), ["经济学"]);
});

test("mail: a 测评 with a cut-off is a deadline day, with its link and time", () => {
  const time = load("src/lib/mail-time.ts", noDb);
  const draft = { title: "综合测评", localStart: "", localEnd: "", timeZone: "Asia/Shanghai", location: "", meetingUrl: "https://exam.example.com/t/abc", evidence: "请于10月20日23:59前完成", deadline: "2026-10-20T23:59", windowStart: "2026-10-15" };
  const value = time.mailTime(draft);
  assert.equal(value.hasTime, false);
  assert.equal(value.startsAt.toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal(value.endsAt.toISOString(), "2026-10-20T00:00:00.000Z");
  assert.match(value.meetingInfo, /https:\/\/exam\.example\.com\/t\/abc/);
  assert.match(value.meetingInfo, /截止 23:59/);
  // Over only after the last day.
  assert.equal(time.mailTimeOver(value), Date.UTC(2026, 9, 21));
  assert.equal(time.mailTime({ ...draft, deadline: "", windowStart: "" }), null);
  assert.equal(time.mailTime({ ...draft, deadline: "下周" }), null);
});

test("待核对: search boxes, date parts, other people and profile fields are not asked about", () => {
  const pending = load("src/lib/pending-application-change.ts", noDb);
  const noise = (questionLabel, answer, kind = "field") => pending.isNoiseAnswer({ questionLabel, answer, kind });
  assert.equal(noise("搜索职位", "产品"), true);
  assert.equal(noise("Day", "12"), true);
  assert.equal(noise("紧急联系人电话", "13800000000"), true);
  assert.equal(noise("+86", "13800000000"), true);
  assert.equal(noise("candidateMobileNumber", "13800000000"), true);
  assert.equal(noise("手机号码", "13800000000"), true);
  assert.equal(noise("学校", "复旦大学"), false);
  assert.equal(noise("为什么选择我们？", "因为……", "essay"), false);
  assert.equal(noise("你最有成就感的一件事", "带队完成……", "essay"), false);
});

test("morning mail: today's interview with its link leads; nothing at all sends nothing", () => {
  const digest = load("src/lib/digest-email.ts", noDb);
  const now = new Date(2026, 9, 21, 8, 0).getTime();
  const at = (h, m = 0, dayOffset = 0) => new Date(2026, 9, 21 + dayOffset, h, m).toISOString();
  const items = [
    { key: "stage:a", source: "stage", sourceId: "a", kind: "interview", startsAt: at(10, 15), endsAt: null, hasTime: true, title: "一面", applicationId: "x", companyName: "宝洁", jobTitle: "管培生", meetingInfo: "腾讯会议 https://meeting.tencent.com/dm/abc 会议号：123 456 789" },
    { key: "stage:b", source: "stage", sourceId: "b", kind: "exam", startsAt: new Date(Date.UTC(2026, 9, 23)).toISOString(), endsAt: null, hasTime: false, title: "测评", applicationId: "y", companyName: "<b>某司</b>", jobTitle: null, meetingInfo: "javascript:alert(1)" },
    { key: "mail:c", source: "mail", sourceId: "c", kind: "interview", startsAt: at(15), endsAt: null, hasTime: true, title: "二面", applicationId: null, companyName: "未确认", jobTitle: null, meetingInfo: null },
    { key: "stage:d", source: "stage", sourceId: "d", kind: "interview", startsAt: at(9, 0, 5), endsAt: null, hasTime: true, title: "终面", applicationId: "z", companyName: "很远", jobTitle: null, meetingInfo: null },
  ];
  const shown = digest.digestSchedule(items, now);
  assert.deepEqual(shown.map((item) => item.key), ["stage:a", "stage:b"]);
  const mail = digest.renderDigestEmail({ todos: [], schedule: shown, now });
  assert.match(mail.subject, /今天 10:15 宝洁 一面/);
  assert.match(mail.html, /href="https:\/\/meeting\.tencent\.com\/dm\/abc"/);
  assert.match(mail.html, /123 456 789/);
  assert.doesNotMatch(mail.html, /href="javascript/);
  assert.doesNotMatch(mail.html, /<b>某司/);
  assert.equal(digest.renderDigestEmail({ todos: [], schedule: [], now }), null);
  const todo = { label: "笔试截止", sublabel: "明天", urgency: "urgent" };
  assert.equal(digest.renderDigestEmail({ todos: [todo], schedule: [], now }).subject, "求职罗盘：1 件事需要关注");
});

test("投递成功 mail: only a 投递 not on record yet", () => {
  const fresh = load("src/lib/mail-new-application.ts", noDb);
  const known = [{ companyNames: ["北京字节跳动科技有限公司", "字节跳动"], title: "产品经理（2027届校招）" }, { companyNames: ["宝洁"], title: "管培生" }];
  assert.equal(fresh.alreadyRecorded("字节跳动", "产品经理", known), true);
  assert.equal(fresh.alreadyRecorded("字节跳动", "后端开发", known), false);
  assert.equal(fresh.alreadyRecorded("宝洁（中国）有限公司", "管理培训生 - 市场部", known), false);
  assert.equal(fresh.alreadyRecorded("宝洁", "", known), true, "no job title: any 投递 to the company counts");
  assert.equal(fresh.alreadyRecorded("美团", "数据分析", known), false);
  assert.equal(fresh.sameCompanyName("腾讯科技（深圳）有限公司", ["腾讯"]), true);
  assert.equal(fresh.sameCompanyName("阿", ["阿里巴巴"]), false);
});

test("找岗位: only boards the career-ops fetchers can read", async () => {
  const ops = load("src/lib/career-ops.ts", noDb);
  assert.equal(ops.supportedBoard("https://jobs.bytedance.com/campus"), true);
  assert.equal(ops.supportedBoard("app.mokahr.com/campus-recruitment/abc/1"), true);
  assert.equal(ops.supportedBoard("https://nxp.wd3.myworkdayjobs.com/careers"), true);
  assert.equal(ops.supportedBoard("https://career.huawei.com"), false);
  assert.equal(ops.supportedBoard("https://join.qq.com"), false);
  assert.equal(ops.supportedBoard(null), false);
  // A file:// URL: a bare Windows path (D:\...) is not an import specifier.
  const runner = await import(require("node:url").pathToFileURL(path.resolve(__dirname, "../electron/career-ops/run.mjs")).href);
  assert.equal(runner.providerFor({ name: "x", careers_url: "https://jobs.bytedance.com" }).id, "feishu-jobs");
  assert.equal(runner.providerFor({ name: "x", careers_url: "https://careers.tencent.com/search.html" }).id, "tencent");
  assert.equal(runner.providerFor({ name: "x", careers_url: "https://career.huawei.com" }), null);
  for (const board of ops.BUILT_IN_BOARDS) {
    assert.equal(ops.supportedBoard(board.careers_url), true, board.name);
    assert.ok(runner.providerFor({ name: board.name, careers_url: board.careers_url }), board.name);
  }
  // Attribution travels with the vendored code.
  assert.match(fs.readFileSync(path.resolve(__dirname, "../electron/career-ops/LICENSE"), "utf8"), /MIT License/);
});

test("isolated DB: a 投递 recorded from mail can be undone; scan health streaks", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/v15-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const migration of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((entry) => /^\d/.test(entry)).sort()) {
    sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", migration, "migration.sql"), "utf8"));
  }
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  t.after(async () => {
    await db.$disconnect();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup");
    fs.rmSync(root, { recursive: true });
  });
  await db.user.create({ data: { id: "local-user", email: "fixture@local" } });
  await db.company.create({ data: { id: "acme", name: "示例科技" } });
  const mocks = {
    "@/lib/db": { db },
    "@/lib/session": { LOCAL_USER_ID: "local-user", requireUser: async () => ({ id: "local-user" }) },
    "next/cache": { revalidatePath() {} },
  };
  const fresh = load("src/lib/mail-new-application.ts", mocks);
  const id = await db.$transaction((tx) => fresh.createApplicationFromMail(tx, { userId: "local-user", companyId: "acme", title: "数据分析师", appliedAt: new Date("2026-10-10T02:00:00Z"), subject: "感谢投递示例科技" }));
  const auto = load("src/lib/auto-progress.ts", mocks);
  const items = await auto.loadAutoProgressItems("local-user");
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "email-new");
  assert.equal(items[0].applicationId, id);
  const undo = load("src/lib/actions/auto-progress.ts", mocks);
  assert.equal((await undo.undoAutoStageUpdate(items[0].id)).ok, true);
  assert.equal(await db.application.count(), 0);
  // Once something was added to it, undo leaves it alone.
  const kept = await db.$transaction((tx) => fresh.createApplicationFromMail(tx, { userId: "local-user", companyId: "acme", title: "产品经理", appliedAt: new Date(), subject: "投递成功" }));
  await db.stageHistory.create({ data: { applicationId: kept, stage: "INTERVIEW_1", enteredAt: new Date() } });
  const row = await db.stageHistory.findFirst({ where: { applicationId: kept, autoSource: "email-new" } });
  const refused = await undo.undoAutoStageUpdate(row.id);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /新进度/);

  const health = load("src/lib/scan-health.ts", mocks);
  await db.mailAccount.create({ data: { userId: "local-user", imapHost: "imap.example.com", imapPort: 993, email: "a@example.com", passwordEncrypted: "x" } });
  await db.user.update({ where: { id: "local-user" }, data: { inboxScanFailStreak: 1, inboxScanError: "x" } });
  assert.equal((await health.getScanHealth("local-user")).failing, false, "one failure is a blip");
  await db.user.update({ where: { id: "local-user" }, data: { inboxScanFailStreak: 2 } });
  assert.equal((await health.getScanHealth("local-user")).failing, true);
  await db.mailAccount.updateMany({ data: { enabled: false } });
  assert.equal((await health.getScanHealth("local-user")).failing, false, "no mailbox switched on, nothing to warn about");
});

test("「奖励名称 / 颁奖机构」 are award fields even when no section heading was read", () => {
  const profile = { awards: [{ name: "志善奖学金", date: "2023.6.18", issuer: "东南大学" }], education: [], experiences: [], projects: [], mappings: [] };
  const fields = [
    { id: "a", label: "奖励名称", section: "" },
    { id: "b", label: "获得时间", section: "奖励荣誉", hasValue: true, currentValue: "2023-06" },
    { id: "c", label: "颁奖机构", section: "" },
  ];
  const { repeats } = core.classifyRepeatBlocks(fields, profile, "");
  assert.deepEqual([repeats.get("a"), repeats.get("c")].map((info) => info && `${info.group}:${info.kind}`), ["award:name", "award:issuer"]);
  assert.equal(repeats.get("b").kind, "date");
});

test("any module taken one entry at a time: an entry already saved above is not written again", () => {
  const saved = ["英语 | CET-6 560", "学生会 · 外联部部长 2021.09 - 2022.06"];
  // The name-like box decides: same 语种 / 活动 → a repeat.
  assert.equal(core.repeatsSavedEntry(saved, [{ label: "语种", value: "英语" }, { label: "等级", value: "CET-4" }]), true);
  assert.equal(core.repeatsSavedEntry(saved, [{ label: "活动名称", value: "学生会" }, { label: "担任角色", value: "副会长" }]), true);
  // A different entry is filled, even when a detail (role, level) matches.
  assert.equal(core.repeatsSavedEntry(saved, [{ label: "活动名称", value: "数学建模协会" }, { label: "担任角色", value: "外联部部长" }]), false);
  assert.equal(core.repeatsSavedEntry(saved, [{ label: "语种", value: "日语" }]), false);
  // Without a name-like box every value must already be there; one-letter values never decide.
  assert.equal(core.repeatsSavedEntry(saved, [{ label: "等级", value: "CET-6 560" }]), true);
  assert.equal(core.repeatsSavedEntry(saved, [{ label: "是否党员", value: "否" }]), false);
});

test("待核对: fragments of an 经历 block, counters, placeholders and login pages are noise", () => {
  const pending = load("src/lib/pending-application-change.ts", noDb);
  const noise = (questionLabel, answer, kind = "short", url = "https://campus.example.com/apply") => pending.isNoiseAnswer({ questionLabel, answer, kind }, url);
  for (const label of ["职位名称", "工作职责", "担任职务", "所在组织", "掌握程度", "单位名称", "第 1志愿"]) assert.equal(noise(label, "某值", label === "工作职责" ? "essay" : "short"), true, label);
  assert.equal(noise("113/2000", "一段话"), true);
  assert.equal(noise("点击选择其他", "x"), true);
  assert.equal(noise("请输入职位名称", "x"), true);
  assert.equal(noise("昵称", "小陈", "short", "https://q.example.com/login"), true);
  assert.equal(noise("本科学习成绩排名", "前 10%"), false);
  assert.equal(noise("（简答题）用过哪些 AI 工具？举一个例子", "……", "essay"), false);
});
