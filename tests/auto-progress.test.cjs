const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Buffer, URL, process, setTimeout, clearTimeout });
  return mod.exports;
}

const flow = load("src/lib/application-flow.ts");

test("automatic updates may write outcomes and unusual orders, never the user's own decisions", () => {
  const { classifyAutoTransition } = flow;
  assert.equal(classifyAutoTransition("APPLIED", "REJECTED"), "apply");
  assert.equal(classifyAutoTransition("INTERVIEW_2", "OFFER"), "apply");
  assert.equal(classifyAutoTransition("HR_INTERVIEW", "OA"), "apply");
  assert.equal(classifyAutoTransition("OFFER", "ACCEPTED"), "none");
  assert.equal(classifyAutoTransition("OFFER", "DECLINED"), "none");
  assert.equal(classifyAutoTransition("OA", "WITHDRAWN"), "none");
  assert.equal(classifyAutoTransition("REJECTED", "OFFER"), "none");
  assert.equal(classifyAutoTransition("OA", "OA"), "none");
  assert.equal(classifyAutoTransition("OA", null), "none");
});

test("portal and email recognition update the timeline directly, and undo sticks", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/auto-progress-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((s) => /^\d/.test(s)).sort()) {
    sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", name, "migration.sql"), "utf8"));
  }
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  t.after(async () => {
    await db.$disconnect();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup");
    fs.rmSync(root, { recursive: true });
  });

  const day = (n) => new Date(Date.UTC(2026, 9, n, 2));
  await db.user.create({ data: { id: "local-user", email: "fixture@local" } });
  assert.equal((await db.user.findUnique({ where: { id: "local-user" } })).autoApplyProgress, true);
  await db.company.create({ data: { id: "acme", name: "示例科技" } });
  await db.company.create({ data: { id: "beta", name: "测试银行" } });
  const portal = await db.applicationPortal.create({ data: { companyId: "acme", url: "https://careers.example.test/me" } });
  const makeApp = (id, companyId, stage, portalId = null) => db.application.create({
    data: { id, userId: "local-user", companyId, title: `${id} 岗位`, currentStage: stage, currentStageDate: day(1), appliedDate: day(1), portalId, stageHistory: { create: { stage, enteredAt: day(1) } } },
  });
  await makeApp("portal-app", "acme", "OA", portal.id);
  await makeApp("mail-app", "beta", "APPLIED");
  await makeApp("old-mail-app", "beta", "INTERVIEW_1");
  await db.stageHistory.create({ data: { applicationId: "old-mail-app", stage: "INTERVIEW_2", enteredAt: day(5) } });
  await db.application.update({ where: { id: "old-mail-app" }, data: { currentStage: "INTERVIEW_2", currentStageDate: day(5) } });

  let aiResponse = null;
  let pageText = "示例科技 我的投递：笔试 很遗憾，未通过";
  const mocks = {
    "@/lib/db": { db },
    "@/lib/session": { LOCAL_USER_ID: "local-user", requireUser: async () => ({ id: "local-user" }) },
    "next/cache": { revalidatePath() {} },
    "@/lib/ai-providers": { getUserAiConfig: async () => ({ provider: "fixture" }), callTextAi: async () => aiResponse },
    "@/lib/render-bridge-client": { renderPageText: async () => pageText },
    "@/lib/imap": {
      getUserScanAccounts: async () => [{ id: "box", label: "测试邮箱" }],
      fetchRecentEmails: async () => [
        { uid: 1, subject: "测试银行 一面邀请", from: "hr@bank.test", date: day(3), snippet: "邀请你参加一面" },
        { uid: 2, subject: "测试银行 笔试通知（旧邮件）", from: "hr@bank.test", date: day(2), snippet: "请完成笔试" },
        { uid: 3, subject: "测试银行 Offer", from: "hr@bank.test", date: day(4), snippet: "录用意向" },
      ],
    },
  };
  const sync = load("src/lib/actions/application-sync.ts", mocks);
  const autoActions = load("src/lib/actions/auto-progress.ts", mocks);
  const autoLib = load("src/lib/auto-progress.ts", mocks);

  // Portal rejection is applied straight away (it used to wait for review).
  aiResponse = { needsLogin: false, entries: [{ applicationId: "portal-app", portalStatus: "很遗憾，未通过", stage: "REJECTED", confident: true }] };
  let result = await sync.syncPortalsNow(undefined, true);
  assert.equal(result.ok, true);
  assert.equal(result.data.changed.length, 1);
  assert.equal(result.data.review.length, 0);
  let app = await db.application.findUnique({ where: { id: "portal-app" } });
  assert.equal(app.currentStage, "REJECTED");
  assert.equal(app.portalSuggestedStage, null);
  const portalEntry = await db.stageHistory.findFirst({ where: { applicationId: "portal-app", autoSource: "portal" } });
  assert.equal(portalEntry.terminatedAtStage, "OA");
  assert.equal(portalEntry.autoEvidence, "官网显示「很遗憾，未通过」");

  let items = await autoLib.loadAutoProgressItems("local-user");
  assert.deepEqual(items.map((item) => item.applicationId), ["portal-app"]);

  // Undo restores the previous stage and the same portal text is not re-applied.
  assert.equal((await autoActions.undoAutoStageUpdate(portalEntry.id)).ok, true);
  app = await db.application.findUnique({ where: { id: "portal-app" } });
  assert.equal(app.currentStage, "OA");
  assert.equal(app.autoUndoneStatus, "很遗憾，未通过");
  pageText += " ";
  result = await sync.syncPortalsNow(undefined, true);
  assert.equal(result.data.changed.length, 0);
  assert.equal((await db.application.findUnique({ where: { id: "portal-app" } })).currentStage, "OA");
  assert.equal((await autoActions.undoAutoStageUpdate(portalEntry.id)).ok, false);

  // A different portal status is new information and is applied.
  aiResponse = { needsLogin: false, entries: [{ applicationId: "portal-app", portalStatus: "一面已安排", stage: "INTERVIEW_1", confident: true }] };
  pageText = "示例科技 我的投递：一面已安排";
  result = await sync.syncPortalsNow(undefined, true);
  assert.equal(result.data.changed.length, 1);
  assert.equal((await db.application.findUnique({ where: { id: "portal-app" } })).currentStage, "INTERVIEW_1");

  // With the switch off, outcomes go back to waiting for confirmation.
  assert.equal((await autoActions.setAutoApplyProgress(false)).ok, true);
  aiResponse = { needsLogin: false, entries: [{ applicationId: "portal-app", portalStatus: "已发 Offer", stage: "OFFER", confident: true }] };
  pageText = "示例科技 我的投递：已发 Offer";
  result = await sync.syncPortalsNow(undefined, true);
  assert.equal(result.data.changed.length, 0);
  assert.equal(result.data.review.length, 1);
  app = await db.application.findUnique({ where: { id: "portal-app" } });
  assert.equal(app.currentStage, "INTERVIEW_1");
  assert.equal(app.portalSuggestedStage, "OFFER");
  assert.equal((await autoActions.setAutoApplyProgress(true)).ok, true);

  // Email: newest mail wins, older mail never overrides a newer stage.
  const inbox = load("src/lib/actions/inbox-scan.ts", mocks);
  aiResponse = {
    results: [
      { index: 0, isJobRelated: true, type: "面试邀请", company: "测试银行", summary: "一面", applicationId: "mail-app", stage: "INTERVIEW_1", stageLabel: "业务一面" },
      { index: 1, isJobRelated: true, type: "笔试通知", company: "测试银行", summary: "笔试", applicationId: "old-mail-app", stage: "OA", stageLabel: null },
      { index: 2, isJobRelated: true, type: "offer", company: "测试银行", summary: "Offer", applicationId: "not-an-application", stage: "OFFER", stageLabel: null },
    ],
  };
  const scan = await inbox.scanInboxNow();
  assert.equal(scan.ok, true);
  assert.equal(scan.data.found, 3);
  assert.equal(scan.data.progressUpdated, 1);
  const mailApp = await db.application.findUnique({ where: { id: "mail-app" } });
  assert.equal(mailApp.currentStage, "INTERVIEW_1");
  assert.equal(mailApp.currentStageLabel, "业务一面");
  assert.equal(mailApp.currentStageDate.getTime(), day(3).getTime());
  assert.equal((await db.application.findUnique({ where: { id: "old-mail-app" } })).currentStage, "INTERVIEW_2");
  assert.equal((await db.personalTask.findFirst({ where: { title: "面试邀请：测试银行" } })).applicationId, "mail-app");
  assert.equal((await db.personalTask.findFirst({ where: { title: "offer：测试银行" } })).applicationId, null);

  // A rescan of the same messages cannot write the stage twice.
  assert.equal((await inbox.scanInboxNow()).data.progressUpdated, 0);
  assert.equal(await db.stageHistory.count({ where: { applicationId: "mail-app", autoSource: "email" } }), 1);

  items = await autoLib.loadAutoProgressItems("local-user");
  assert.equal(items.length, 2);
  assert.equal((await autoActions.dismissAutoStageUpdates(items.map((item) => item.id))).ok, true);
  assert.equal((await autoLib.loadAutoProgressItems("local-user")).length, 0);
});
