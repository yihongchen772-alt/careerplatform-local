const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient } = require('@prisma/client');
function load(file, mocks = {}, globals = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => mocks[id] || require(id), Date, Error, console: { error() {} }, ...globals });
  return mod.exports;
}
const schedule = load('src/lib/email-reminder-schedule.ts');
test('daily email schedule uses saved zone, minute boundary, DST and enabled flag', () => {
  const config = { enabled: true, time: '09:15', timeZone: 'Asia/Shanghai' };
  assert.equal(schedule.dueEmailReminderDay(config, new Date('2026-10-02T01:14:59Z')), null);
  assert.equal(schedule.dueEmailReminderDay(config, new Date('2026-10-02T01:15:00Z')), '2026-10-02');
  assert.equal(schedule.dueEmailReminderDay(config, new Date('2026-10-02T23:00:00Z')), null);
  assert.equal(schedule.dueEmailReminderDay({ ...config, enabled: false }), null);
  assert.equal(schedule.dueEmailReminderDay({ ...config, time: '25:00' }), null);
  assert.equal(schedule.dueEmailReminderDay({ ...config, timeZone: 'Invalid/Zone' }), null);
  const ny = { ...config, time: '09:00', timeZone: 'America/New_York' };
  assert.equal(schedule.dueEmailReminderDay(ny, new Date('2026-07-01T13:00:00Z')), '2026-07-01');
  assert.equal(schedule.dueEmailReminderDay(ny, new Date('2026-12-01T13:00:00Z')), null);
  assert.equal(schedule.dueEmailReminderDay(ny, new Date('2026-12-01T14:00:00Z')), '2026-12-01');
});
test('scheduled digest persists daily deduplication, claims concurrent checks, retries failures and respects manual send', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcompass-mail-test-'));
  const file = path.join(root, 'fixture.db');
  const sql = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.join(__dirname, '../prisma/migrations')).filter((s) => /^\d/.test(s)).sort()) sql.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8'));
  sql.exec("INSERT INTO User(id,email,smtpUser,emailReminderTime,emailReminderTimeZone) VALUES ('fixture','fixture@local','mail@example.test','09:00','Asia/Shanghai')");
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  t.after(async () => { await db.$disconnect(); fs.rmSync(root, { recursive: true }); });
  let now = new Date('2026-10-02T00:59:00Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } }
  let sent = 0, urgent = true, fail = false, release, started;
  const signal = new Promise((r) => { started = r; });
  const wait = new Promise((r) => { release = r; });
  let pause = true;
  const empty = { findMany: async () => [] };
  const dbFacade = { user: db.user, application: empty, position: empty, stageHistory: empty, personalTask: empty, contact: empty, calendarEvent: empty };
  const mocks = { '@/lib/db': { db: dbFacade }, '@/lib/session': { requireUser: async () => ({ id: 'fixture' }) }, '@/lib/email-reminder-schedule': schedule,
    '@/lib/todos': { buildTodos: () => urgent ? [{ label: '<面试>', sublabel: '明天', urgency: 'urgent' }] : [] },
    '@/lib/action-result': load('src/lib/action-result.ts'),
    '@/lib/mailer': { getUserMailConfig: async () => ({ user: 'mail@example.test' }), sendMail: async (_config, mail) => { assert.match(mail.html, /&lt;面试&gt;|暂时没有/); if (fail) throw new Error('SMTP fixture failure'); sent++; if (pause) { started(); await wait; } } } };
  const actions = load('src/lib/actions/reminder-digest.ts', mocks, { Date: Clock });
  await actions.checkAndSendOnLaunch('fixture'); assert.equal(sent, 0);
  now = new Date('2026-10-02T01:00:00Z');
  const first = actions.checkAndSendOnLaunch('fixture'); await signal;
  await actions.checkAndSendOnLaunch('fixture'); assert.equal(sent, 1);
  release(); await first; pause = false;
  // Fresh module simulates restart: state is retained in the database.
  await load('src/lib/actions/reminder-digest.ts', mocks, { Date: Clock }).checkAndSendOnLaunch('fixture'); assert.equal(sent, 1);
  assert.equal((await db.user.findUnique({ where: { id: 'fixture' } })).emailReminderLastDay, '2026-10-02');
  now = new Date('2026-10-03T02:00:00Z'); fail = true;
  await actions.checkAndSendOnLaunch('fixture');
  let user = await db.user.findUnique({ where: { id: 'fixture' } });
  assert.equal(user.emailReminderLastDay, '2026-10-02'); assert.equal(user.emailReminderClaimUntil, null); assert.match(user.emailReminderLastError, /SMTP/);
  fail = false; await actions.checkAndSendOnLaunch('fixture'); assert.equal(sent, 2);
  await db.user.update({ where: { id: 'fixture' }, data: { emailReminderEnabled: false } });
  now = new Date('2026-10-04T03:00:00Z'); await actions.checkAndSendOnLaunch('fixture'); assert.equal(sent, 2);
  await actions.sendReminderDigestNow(); assert.equal(sent, 3);
  await db.user.update({ where: { id: 'fixture' }, data: { emailReminderEnabled: true } }); urgent = false;
  await actions.checkAndSendOnLaunch('fixture'); assert.equal(sent, 3);
  user = await db.user.findUnique({ where: { id: 'fixture' } }); assert.equal(user.emailReminderLastDay, '2026-10-04');
  const settings = load('src/lib/actions/email-settings.ts', { ...mocks, 'next/cache': { revalidatePath() {} }, '@/lib/crypto': {}, '@/lib/validation': {} });
  assert.equal((await settings.updateEmailReminderSchedule({ enabled: true, time: '25:00', timeZone: 'UTC' })).ok, false);
  assert.equal((await settings.updateEmailReminderSchedule({ enabled: true, time: '10:30', timeZone: 'Asia/Singapore' })).ok, true);
  user = await db.user.findUnique({ where: { id: 'fixture' } }); assert.equal(user.emailReminderTime, '10:30'); assert.equal(user.smtpUser, 'mail@example.test');
});

test('desktop checks mail every minute while open without background mode, and keeps running in enabled background mode', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const start = source.indexOf('function startEmailReminderLoop()');
  const end = source.indexOf('function startReminderLoop()', start);
  let tick, interval, requests = 0;
  const settings = { backgroundReminders: false };
  const context = vm.createContext({ emailReminderTimer: null, mainWindow: { isDestroyed: () => false }, PORT: 3210, process: { env: {} }, AbortSignal,
    readAppSettings: () => settings, setInterval: (fn, ms) => { tick = fn; interval = ms; return 1; }, fetch: async (url) => { assert.match(url, /check-email-reminders$/); requests++; } });
  vm.runInContext(source.slice(start, end) + '\nstartEmailReminderLoop();', context);
  assert.equal(interval, 60000); await tick(); assert.equal(requests, 1);
  context.mainWindow = null; await tick(); assert.equal(requests, 1);
  settings.backgroundReminders = true; await tick(); assert.equal(requests, 2);
});

test('a claimed email checks the latest schedule and mailbox before SMTP, and releases only its own lease', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcompass-mail-cancel-'));
  const file = path.join(root, 'fixture.db'), sql = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.join(__dirname, '../prisma/migrations')).filter((s) => /^\d/.test(s)).sort()) sql.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8'));
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  t.after(async () => { await db.$disconnect(); fs.rmSync(root, { recursive: true }); });
  const now = new Date('2026-10-03T10:00:00Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } }
  let sent = 0;
  for (const mutation of [
    { emailReminderEnabled: false }, { emailReminderTime: '23:00' }, { emailReminderTimeZone: 'Asia/Shanghai' },
    { smtpUser: null }, { emailReminderClaimUntil: null }, { emailReminderClaimUntil: new Date(now.getTime() + 600000) },
  ]) {
    await db.user.deleteMany();
    await db.user.create({ data: { id: 'fixture', email: 'fixture@local', smtpUser: 'mail@example.invalid', emailReminderTime: '09:00', emailReminderTimeZone: 'UTC' } });
    let started, release;
    const signal = new Promise((r) => { started = r; }), wait = new Promise((r) => { release = r; });
    const empty = { findMany: async () => [] };
    const actions = load('src/lib/actions/reminder-digest.ts', {
      '@/lib/db': { db: { user: db.user, application: { findMany: async () => { started(); await wait; return []; } }, position: empty, stageHistory: empty, personalTask: empty, contact: empty, calendarEvent: empty } },
      '@/lib/session': {}, '@/lib/email-reminder-schedule': schedule, '@/lib/action-result': load('src/lib/action-result.ts'),
      '@/lib/todos': { buildTodos: () => [{ label: 'fixture', sublabel: 'fixture', urgency: 'urgent' }] },
      '@/lib/mailer': { getUserMailConfig: async () => ({ user: 'mail@example.invalid' }), sendMail: async () => { sent++; } },
    }, { Date: Clock });
    const pending = actions.checkAndSendOnLaunch('fixture'); await signal;
    await db.user.update({ where: { id: 'fixture' }, data: mutation }); release(); await pending;
    assert.equal(sent, 0, JSON.stringify(mutation));
    const user = await db.user.findUnique({ where: { id: 'fixture' } });
    assert.equal(user.emailReminderLastDay, null);
    if (mutation.emailReminderClaimUntil) assert.equal(user.emailReminderClaimUntil.getTime(), mutation.emailReminderClaimUntil.getTime(), 'must not clear a replacement lease');
    else assert.equal(user.emailReminderClaimUntil, null);
  }
});
