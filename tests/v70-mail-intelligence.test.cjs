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
  const resolved = path.resolve(__dirname, "..", file);
  const compiled = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(
    compiled,
    {
      exports: mod.exports,
      module: mod,
      require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)),
      console,
      Date,
      Error,
      Buffer,
      URL,
      process,
      setTimeout,
      clearTimeout,
    }
  );
  return mod.exports;
}

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

test("v70 Step 1: extracts accessCode & actionRequired/actionDeadline safely without catching OTPs", () => {
  const extract = load("src/lib/mail-time-extract.ts");
  const mailTime = load("src/lib/mail-time.ts");
  const sched = load("src/lib/interview-schedule.ts");

  assert.equal(extract.extractMailAccessCode("腾讯会议链接：https://meeting.tencent.com/dm/AbC 会议密码：918273"), "918273");
  assert.equal(extract.extractMailAccessCode("牛客笔试作答口令: EX2027#88，请提前调试"), "EX2027#88");
  assert.equal(extract.extractMailAccessCode("您的登录验证码：665544，5分钟内有效"), "");
  assert.equal(extract.extractMailAccessCode("Passcode will be sent separately before interview"), "");

  const action = extract.extractMailActionItem(
    "录用意向确认",
    "恭喜通过终面，请您在2027年3月10日18:00前确认是否接受Offer并回复邮件。",
    new Date("2027-03-05T02:00:00Z")
  );
  assert.ok(action);
  assert.ok(/确认/.test(action.actionRequired));
  assert.equal(action.actionDeadline, "2027-03-10T18:00");

  const due = mailTime.parseActionDeadlineDate(action.actionDeadline, "Asia/Shanghai");
  assert.ok(due instanceof Date);
  assert.equal(due.toISOString(), "2027-03-10T10:00:00.000Z");

  const draft = extract.completeMailDraft({
    ai: null,
    subject: "星海科技笔试邀请",
    body: "考试时间：2027-03-12 19:00-21:00，考试链接 https://exam.example.cn/t/123，笔试口令：XH2027",
    mailDate: new Date("2027-03-08T01:00:00Z"),
    type: "笔试通知",
    company: "星海科技",
  });
  assert.ok(draft);
  assert.equal(draft.accessCode, "XH2027");
  const mt = mailTime.mailTime(draft);
  assert.equal(mt.accessCode, "XH2027");
  assert.ok(mt.meetingInfo.includes("口令：XH2027"));
  assert.equal(sched.extractAccessCode(mt.meetingInfo), "XH2027");
  assert.ok(sched.meetingSummary(mt.meetingInfo, true).includes("口令 XH2027"));

  const meta = mailTime.mailDraftMeta(null, "请确认Offer\n\n邮件主题：Offer\n来自：hr@a.cn\n收件箱：主邮箱\n待办：回复确认（截止 2027-03-10）\n口令：ABC999");
  assert.equal(meta.accessCode, "ABC999");
  assert.equal(meta.actionRequired, "回复确认");
  assert.equal(meta.actionDeadline, "2027-03-10");
});

test("v70 Step 1: pendingMailRows detects overlapping calendar slots and preserves metadata", () => {
  const { pendingMailRows } = load("src/lib/pending-mail.ts");
  const now = new Date("2027-04-01T00:00:00Z").getTime();
  const existingSlots = [
    { key: "ev1", startsAt: "2027-04-05T06:00:00.000Z", endsAt: "2027-04-05T07:00:00.000Z", label: "腾讯 · 后端一面" },
  ];
  const rows = pendingMailRows(
    [
      {
        id: "t1",
        title: "面试邀请：星辰科技",
        note: "一面安排\n\n邮件主题：星辰科技面试\n来自：hr@star.com\n收件箱：主邮箱\n待办：确认是否参会\n口令：556677",
        mailEventDraft: {
          title: "星辰科技 一面",
          localStart: "2027-04-05T14:00",
          localEnd: "2027-04-05T15:00",
          timeZone: "Asia/Shanghai",
          location: "",
          meetingUrl: "https://meeting.tencent.com/dm/123",
          accessCode: "556677",
          actionRequired: "确认是否参会",
          actionDeadline: "",
          evidence: "4月5日 14:00",
          deadline: "",
          windowStart: "",
          booking: false,
        },
        applicationId: null,
        positionId: "pos1",
        positionLabel: "星辰科技 · 后端开发",
        createdAt: new Date("2027-04-01T00:00:00Z"),
      },
    ],
    now,
    new Set(),
    existingSlots
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clashWith, "腾讯 · 后端一面");
  assert.equal(rows[0].accessCode, "556677");
  assert.equal(rows[0].actionRequired, "确认是否参会");
  assert.equal(rows[0].positionId, "pos1");
  assert.equal(rows[0].positionLabel, "星辰科技 · 后端开发");
});

test("v70 Step 2: sender corporate domain matches Company.careerUrl while shared ATS/webmail hosts are ignored", () => {
  const { resolveMailApplication, senderRootDomain } = load("src/lib/mail-application-match.ts");
  assert.equal(senderRootDomain("HR <campus@mail.exampletech.com.cn>"), "exampletech.com.cn");
  assert.equal(senderRootDomain("Moka <noreply@mokahr.com>"), null);
  assert.equal(senderRootDomain("QQ <hr@qq.com>"), null);

  const apps = [
    { id: "app1", companyName: "远景动力", careerUrls: ["https://careers.exampletech.com.cn/campus"], title: "嵌入式软件工程师" },
    { id: "app2", companyName: "微光智造", careerUrls: ["https://jobs.glow.io/"], title: "后端工程师" },
  ];
  // Mail doesn't mention "远景动力" in subject, only corporate sender domain.
  const hit = resolveMailApplication(
    { subject: "在线测评邀请函", company: null, summary: "请参加线上测试", body: "请在48小时内作答", jobTitle: null, from: "Recruiting <hr@mail.exampletech.com.cn>" },
    null,
    apps,
    apps
  );
  assert.equal(hit, "app1");

  // Shared ATS sender domain must NOT guess an application when name is absent.
  const noHit = resolveMailApplication(
    { subject: "在线测评邀请函", company: null, summary: "请参加线上测试", body: "", jobTitle: null, from: "Moka <noreply@mokahr.com>" },
    null,
    apps,
    apps
  );
  assert.equal(noHit, null);
});

test("v70 Steps 1-3 E2E DB: read-only matching when autoApply=false, conflict resolution, pool binding, & timeline UI", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/v70-mail-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((s) => /^\d/.test(s)).sort()) {
    sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", name, "migration.sql"), "utf8"));
  }
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  t.after(async () => {
    await db.$disconnect();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await db.user.create({ data: { id: "local-user", email: "local@test.invalid", name: "测试", autoApplyProgress: false } });
  const c1 = await db.company.create({ data: { name: "矩阵科技", careerUrl: "https://jobs.matrixtech.cn" } });
  const c2 = await db.company.create({ data: { name: "云杉软件" } });

  const manualDeadline = new Date("2028-06-10T06:00:00Z");
  const app1 = await db.application.create({
    data: {
      id: "app-matrix",
      userId: "local-user",
      companyId: c1.id,
      title: "后端工程师",
      appliedDate: new Date("2028-06-01T00:00:00Z"),
      currentStage: "INTERVIEW_1",
      currentStageDate: new Date("2028-06-02T00:00:00Z"),
      stageHistory: {
        create: {
          stage: "INTERVIEW_1",
          enteredAt: new Date("2028-06-02T00:00:00Z"),
          nextDeadline: manualDeadline,
          nextHasTime: true,
          scheduleSource: null,
        },
      },
    },
  });
  const poolPos = await db.position.create({
    data: { id: "pos-spruce", userId: "local-user", companyId: c2.id, title: "算法工程师", status: "EVALUATING" },
  });
  await db.mailAccount.create({
    data: { id: "acc1", userId: "local-user", label: "主邮箱", email: "me@example.test", imapHost: "imap.example.test", imapPort: 993, passwordEncrypted: "x", enabled: true },
  });

  let fetchedEmails = [
    {
      uid: 10,
      from: "HR <talent@campus.matrixtech.cn>",
      subject: "面试时间更新：后端工程师一面",
      date: new Date("2028-06-03T04:00:00Z"),
      snippet: "您的面试将于 2028-06-12 15:00-16:00 进行，会议密码：778899，请准时参加。",
      calendarInvite: null,
    },
    {
      uid: 11,
      from: "hr@spruce.invalid",
      subject: "云杉软件 算法工程师 笔试通知",
      date: new Date("2028-06-03T05:00:00Z"),
      snippet: "请在 2028-06-08 20:00 前完成在线笔试，作答口令：SP2028。",
      calendarInvite: null,
    },
  ];
  let aiRes = {
    results: [
      {
        index: 0,
        isJobRelated: true,
        type: "面试改期",
        company: null,
        summary: "矩阵科技一面改期",
        applicationId: null,
        stage: "INTERVIEW_2",
        stageLabel: "二面",
        accessCode: "778899",
        actionRequired: "确认参会",
        actionDeadline: null,
        event: { title: "矩阵科技 一面", localStart: "2028-06-12T15:00", localEnd: "2028-06-12T16:00", timeZone: "Asia/Shanghai", location: "线上", meetingUrl: "", accessCode: "778899", evidence: "2028-06-12 15:00-16:00", deadline: "", windowStart: "" },
      },
      {
        index: 1,
        isJobRelated: true,
        type: "笔试通知",
        company: "云杉集团",
        summary: "算法岗线上笔试",
        applicationId: null,
        stage: "OA",
        stageLabel: null,
        accessCode: "SP2028",
        actionRequired: "完成线上笔试",
        actionDeadline: "2028-06-08T20:00",
        event: { title: "云杉软件 笔试", localStart: "", localEnd: "", timeZone: "Asia/Shanghai", location: "", meetingUrl: "https://exam.spruce.test/1", accessCode: "SP2028", evidence: "2028-06-08 20:00 前", deadline: "2028-06-08T20:00", windowStart: "" },
      },
    ],
  };

  const mocks = {
    "@/lib/db": { db },
    "@/lib/session": { requireUser: async () => ({ id: "local-user" }) },
    "next/cache": { revalidatePath: () => {} },
    "@/lib/ai-providers": { getUserAiConfig: async () => ({ provider: "test" }), callTextAi: async () => aiRes },
    "@/lib/imap": { getUserScanAccounts: async () => [{ id: "acc1", label: "主邮箱" }], fetchRecentEmails: async () => fetchedEmails, fetchEmailsByUid: async () => [] },
    "@/lib/scan-health": { SCAN_ALERT_STREAK: 2 },
    "@/lib/dates": load("src/lib/dates.ts"),
  };

  const inbox = load("src/lib/actions/inbox-scan.ts", mocks);
  const autoLib = load("src/lib/auto-progress.ts", mocks);
  const mailCal = load("src/lib/actions/mail-calendar.ts", mocks);

  // autoApplyProgress is false, yet domain match links app1 and pool match links pos-spruce!
  const scan1 = await inbox.scanInboxNow();
  assert.equal(scan1.ok, true);
  assert.equal(scan1.data.found, 2);
  assert.equal(scan1.data.progressUpdated, 0);
  const afterApp = await db.application.findUnique({ where: { id: app1.id } });
  assert.equal(afterApp.currentStage, "INTERVIEW_1");

  const tMatrix = await db.personalTask.findFirst({ where: { userId: "local-user", sourceMailKey: "acc1:10" } });
  assert.equal(tMatrix.applicationId, app1.id);
  const tSpruce = await db.personalTask.findFirst({ where: { userId: "local-user", sourceMailKey: "acc1:11" } });
  assert.equal(tSpruce.applicationId, null);
  assert.equal(tSpruce.positionId, poolPos.id);
  assert.ok(tSpruce.dueDate instanceof Date);

  // Manual deadline vs mail schedule on app1 produces a surfaced conflict in loadMailScheduleConflicts!
  const conflicts = await autoLib.loadMailScheduleConflicts("local-user");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].applicationId, app1.id);
  assert.ok(conflicts[0].meetingInfo.includes("口令：778899"));

  // Manual promotion/binding of pool position task creates an APPLIED application & learns alias!
  const bindRes = await mailCal.bindMailTask(tSpruce.id, { kind: "position", id: poolPos.id });
  assert.equal(bindRes.ok, true);
  assert.equal(bindRes.data.promoted, true);
  const promotedPos = await db.position.findUnique({ where: { id: poolPos.id } });
  assert.equal(promotedPos.status, "APPLIED");
  const boundTask = await db.personalTask.findUnique({ where: { id: tSpruce.id } });
  assert.equal(boundTask.applicationId, bindRes.data.applicationId);
});

test("v70 Step 3: stage-aware next actions and application detail mail timeline", () => {
  const { nextActionsForMail } = load("src/lib/interview-schedule.ts");
  const offerActs = nextActionsForMail({ text: "录用通知", stage: "OFFER", applicationId: "a1", companyName: "字节" });
  assert.deepEqual([...offerActs.map((a) => a.href)], ["/applications/a1#offer", "/compare"]);

  const interviewActs = nextActionsForMail({ text: "技术一面", stage: "INTERVIEW_1", applicationId: "a2", companyName: "腾讯" });
  assert.deepEqual([...interviewActs.map((a) => a.href)], ["/applications/a2#interview-qa", "/mock-interview?application=a2"]);

  const examActs = nextActionsForMail({ text: "在线笔试邀请", stage: "OA", applicationId: "a3", companyName: "美团" });
  assert.deepEqual([...examActs.map((a) => a.href)], ["/question-banks", "/applications/a3#materials"]);

  const assessActs = nextActionsForMail({ text: "性格测评", stage: "ASSESSMENT", applicationId: null, companyName: "百度" });
  assert.equal(assessActs[0].href, "/personality");

  assert.match(read("src/app/(dashboard)/applications/[id]/page.tsx"), /ApplicationMailTimeline/);
  assert.match(read("src/components/applications/auto-progress-banner.tsx"), /nextActionsForMail/);
  assert.match(read("src/components/calendar/pending-mail-panel.tsx"), /nextActionsForMail/);
  assert.match(read("src/components/schedule/meeting-actions.tsx"), /extractAccessCode/);
});
