const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
function loader(mocks = {}, globals = {}) {
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file].exports;
    const mod = { exports: {} }; cache[file] = mod;
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => mocks[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : require(id)), Buffer, URL, URLSearchParams, Date, Error, process, AbortSignal, console: { error() {} }, setTimeout, clearTimeout, ...globals }, { filename: file });
    return mod.exports;
  }
  return load;
}
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcompass-integrity-'));
  const file = path.join(dir, 'fixture.db'), uploads = path.join(dir, 'uploads');
  fs.mkdirSync(uploads);
  const sql = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).filter((s) => /^\d/.test(s)).sort()) sql.exec(fs.readFileSync(path.join(root, 'prisma/migrations', name, 'migration.sql'), 'utf8'));
  sql.exec('PRAGMA journal_mode=WAL'); sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  await db.user.create({ data: { id: 'local-user', email: 'fixture@example.invalid' } });
  await db.resumeVersion.create({ data: { id: 'resume', userId: 'local-user', name: '虚构简历', fileUrl: '/api/files/fixture.pdf' } });
  fs.writeFileSync(path.join(uploads, 'fixture.pdf'), 'ORIGINAL');
  const load = loader({ '@/lib/db': { db }, '@/lib/session': { LOCAL_USER_ID: 'local-user', requireUser: async () => ({ id: 'local-user' }) }, 'next/cache': { revalidatePath() {} } }, { process: { env: { LOCAL_UPLOADS_DIR: uploads }, cwd: () => root } });
  t.after(async () => { await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, load, dir, file, uploads };
}
function emptyBackup() { return { backupVersion: 1, exportedAt: '2026-10-03T00:00:00.000Z', data: { user: [{ id: 'web-user', email: 'fixture@example.invalid' }], company: [], position: [], application: [], resumeVersion: [] }, files: {} }; }

test('incomplete, malformed or unsafe backup previews and restores cannot wipe existing data', async (t) => {
  const { load, db, uploads } = await fixture(t);
  const actions = load('src/lib/actions/backup.ts');
  const bad = [{ backupVersion: 1 }, null, { ...emptyBackup(), data: {} }, { ...emptyBackup(), files: [] }];
  const missingUser = emptyBackup(); missingUser.data.user = []; bad.push(missingUser);
  const wrongColumn = emptyBackup(); wrongColumn.data.user[0].smtpPort = 'wrong'; bad.push(wrongColumn);
  const unknown = emptyBackup(); unknown.data.user[0].surprise = 'wrong'; bad.push(unknown);
  const pathTraversal = emptyBackup(); pathTraversal.files['../fixture.pdf'] = 'eA=='; bad.push(pathTraversal);
  const brokenBase64 = emptyBackup(); brokenBase64.files['fixture.pdf'] = '!!!'; bad.push(brokenBase64);
  const missingFile = emptyBackup(); missingFile.data.resumeVersion = [{ id: 'r', userId: 'web-user', name: '虚构', fileUrl: '/api/files/missing.pdf' }]; bad.push(missingFile);
  for (const value of bad) {
    assert.equal((await actions.previewBackup(JSON.stringify(value))).ok, false);
    assert.equal((await actions.importBackup(JSON.stringify(value))).ok, false);
    assert.equal(await db.resumeVersion.count(), 1);
    assert.equal(await db.user.count(), 1);
    assert.equal(fs.readFileSync(path.join(uploads, 'fixture.pdf'), 'utf8'), 'ORIGINAL');
  }
  assert.equal((await actions.previewBackup(JSON.stringify(emptyBackup()))).ok, true, 'old backups may omit later feature tables');
});

test('restore transaction failure preserves original rows and attachment bytes; successful restore uses fresh paths', async (t) => {
  const { load, db, uploads } = await fixture(t);
  const core = load('src/lib/backup-core.ts'), actions = load('src/lib/actions/backup.ts');
  const incoming = JSON.parse((await core.buildBackupPayload()).payload);
  incoming.files['fixture.pdf'] = Buffer.from('REPLACED').toString('base64');
  incoming.data.company = [{ id: 'a', name: 'duplicate' }, { id: 'b', name: 'duplicate' }];
  assert.equal((await actions.importBackup(JSON.stringify(incoming))).ok, false);
  assert.equal((await db.resumeVersion.findUnique({ where: { id: 'resume' } })).fileUrl, '/api/files/fixture.pdf');
  assert.equal(fs.readFileSync(path.join(uploads, 'fixture.pdf'), 'utf8'), 'ORIGINAL');
  assert.deepEqual(fs.readdirSync(uploads), ['fixture.pdf']);
  incoming.data.company = [];
  const result = await actions.importBackup(JSON.stringify(incoming));
  assert.equal(result.ok, true);
  const row = await db.resumeVersion.findUnique({ where: { id: 'resume' } });
  assert.notEqual(row.fileUrl, '/api/files/fixture.pdf');
  assert.equal(fs.readFileSync(path.join(uploads, row.fileUrl.split('/').pop()), 'utf8'), 'REPLACED');
  assert.equal(fs.readFileSync(path.join(uploads, 'fixture.pdf'), 'utf8'), 'ORIGINAL');
  assert.ok(!fs.readdirSync(uploads).some((f) => f.startsWith('.restore-')));
  assert.equal((await core.buildBackupPayload()).files, 1, 'retained old files must not inflate new backups');
});

test('JSON backup uses one SQLite snapshot even when another writer commits between table reads', async (t) => {
  const { db, file, uploads } = await fixture(t);
  let writerDone;
  const facade = { $transaction: (callback, options) => db.$transaction((tx) => callback(new Proxy(tx, { get(target, key) {
    if (key !== 'company') return target[key];
    return { findMany: async () => {
      const rows = await tx.company.findMany();
      // Node and Prisma embed separate SQLite libraries; their in-process
      // locks cannot coordinate. Use another process, as a real competing writer.
      const child = require('node:child_process').spawn(process.execPath, ['-e', `
        const { DatabaseSync } = require('node:sqlite');
        const sql = new DatabaseSync(process.argv[1]); sql.exec('PRAGMA busy_timeout=5000');
        process.stdout.write('ready');
        sql.exec("INSERT INTO Company(id,name) VALUES ('new-company','虚构新公司'); INSERT INTO Position(id,userId,companyId,title) VALUES ('new-position','local-user','new-company','虚构岗位')");
        sql.close();`, file]);
      writerDone = new Promise((resolve, reject) => { let errors = ''; child.stderr.on('data', (chunk) => { errors += chunk; }); child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(errors))); });
      await new Promise((resolve) => child.stdout.once('data', resolve));
      return rows;
    } };
  } })), options) };
  const load = loader({ '@/lib/db': { db: facade } }, { process: { env: { LOCAL_UPLOADS_DIR: uploads }, cwd: () => root } });
  const snapshot = JSON.parse((await load('src/lib/backup-core.ts').buildBackupPayload()).payload);
  await writerDone; assert.equal(await db.position.count(), 1);
  assert.equal(snapshot.data.company.length, 0); assert.equal(snapshot.data.position.length, 0);
});

test('backup ignores subdirectories, includes subsequent regular files, and refuses missing referenced files or symlinks', async (t) => {
  const { load, uploads, db } = await fixture(t), core = load('src/lib/backup-core.ts');
  fs.mkdirSync(path.join(uploads, 'a-directory')); fs.writeFileSync(path.join(uploads, 'valid.pdf'), 'valid');
  await db.attachment.create({ data: { userId: 'local-user', name: '虚构附件', url: '/api/files/valid.pdf' } });
  assert.equal((await core.buildBackupPayload()).files, 2);
  fs.unlinkSync(path.join(uploads, 'fixture.pdf'));
  await assert.rejects(core.buildBackupPayload(), /fixture.pdf/);
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(uploads, 'valid.pdf'), path.join(uploads, 'fixture.pdf'));
    await assert.rejects(core.buildBackupPayload(), /符号链接/);
  }
});

test('remote attachment downloads reject private DNS and private redirects; pinned public streams have size and deadline limits', async () => {
  let addresses = [{ address: '127.0.0.1', family: 4 }], calls = 0, redirect = false, large = false, closed = 0;
  const load = loader({
    'node:dns/promises': { lookup: async (host) => host === 'private.example.invalid' ? [{ address: '10.0.0.1', family: 4 }] : addresses },
    undici: { Agent: class { constructor(options) { this.options = options; } async destroy() { closed++; } }, request: async (_url, options) => {
      calls++; assert.ok(options.signal); assert.equal(options.headers['accept-encoding'], 'identity');
      options.dispatcher.options.connect.lookup('ignored', { all: true }, (_err, pinned) => assert.equal(pinned, addresses));
      const body = { destroy() {}, async *[Symbol.asyncIterator]() { yield large ? { length: 51 * 1024 * 1024 } : Buffer.from('PDF'); } };
      return redirect ? { statusCode: 302, headers: { location: 'https://private.example.invalid/file.pdf' }, body } : { statusCode: 200, headers: { 'content-type': 'application/pdf' }, body };
    } },
  });
  const { fetchBackupFile } = load('src/lib/fetch-backup-file.ts');
  await assert.rejects(fetchBackupFile('http://127.0.0.1/file.pdf'), /内网/); assert.equal(calls, 0);
  addresses = [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }];
  await assert.rejects(fetchBackupFile('https://public.example.invalid/file.pdf'), /内网/); assert.equal(calls, 0);
  addresses = [{ address: '93.184.216.34', family: 4 }]; redirect = true;
  await assert.rejects(fetchBackupFile('https://public.example.invalid/file.pdf'), /内网/); assert.equal(calls, 1); assert.equal(closed, 1);
  redirect = false; large = true;
  await assert.rejects(fetchBackupFile('https://public.example.invalid/file.pdf'), /50MB/);
  large = false; assert.equal((await fetchBackupFile('https://public.example.invalid/file.pdf')).buffer.toString(), 'PDF');
  const controller = new AbortController(); controller.abort();
  const timed = loader({ 'node:dns/promises': { lookup: () => { throw new Error('must not resolve'); } } }, { AbortSignal: { timeout: () => controller.signal } });
  await assert.rejects(timed('src/lib/fetch-backup-file.ts').fetchBackupFile('https://public.example.invalid/file.pdf'), /abort/i);
});

test('WebDAV rejects HTTP before sending credentials, and never follows an HTTPS redirect', async () => {
  let calls = 0;
  const load = loader({ '@/lib/db': { db: {} }, '@/lib/session': { LOCAL_USER_ID: 'fixture' }, '@/lib/crypto': {}, '@/lib/backup-core': {} }, { fetch: async (_url, options) => { calls++; assert.equal(options.redirect, 'manual'); return { status: 302 }; } });
  const auto = load('src/lib/auto-backup.ts');
  const target = { url: 'http://dav.example.invalid/path', user: 'fixture', password: 'fixture' };
  await assert.rejects(auto.testWebdav(target), /HTTPS/); assert.equal(calls, 0);
  await assert.rejects(auto.testWebdav({ ...target, url: 'https://dav.example.invalid/path' }), /重定向/); assert.equal(calls, 1);
});

test('cached answers cannot cross negation, dates, quantities or subjects', async () => {
  const cached = [{ id: 'cached', questionLabel: '您是否愿意经常出差？', answer: '是', kind: 'choice', confirmed: true, contextKey: null }];
  const load = loader({ 'next/server': { NextResponse: { json: (data, init) => ({ data, status: init?.status ?? 200 }) } }, '@/lib/db': { db: { resumeVersion: { findFirst: async () => ({ fileUrl: '/api/files/fixture.pdf', extractedText: 'fixture' }) }, autofillAnswer: { findMany: async () => cached } } }, '@/lib/session': { requireUser: async () => ({ id: 'fixture' }) }, '@/lib/gemini': {}, '@/lib/ai-file-search': {}, '@/lib/ai-providers': { getUserAiConfig: async () => null }, '@/lib/resume-extract': {} });
  const { POST } = load('src/app/api/desktop-browser/answer-questions/route.ts');
  async function ask(label, kind = 'choice') { return POST({ json: async () => ({ resumeVersionId: 'fixture', questions: [{ id: 'q', label, kind, options: ['是', '否'] }] }) }); }
  assert.equal((await ask('您是否愿意经常出差？')).data.answers[0].reused, true);
  assert.equal((await ask('您是否不愿意经常出差？')).status, 400);
  for (const [before, after] of [['2026 年可入职吗？', '2027 年可入职吗？'], ['每周工作 3 天吗？', '每周工作 5 天吗？'], ['为什么选择甲公司？', '为什么选择乙公司？']]) {
    cached[0].questionLabel = before; cached[0].kind = 'essay';
    assert.equal((await ask(after, 'essay')).status, 400);
  }
});

const core = require('../electron/autofill-core.js');
test('unknown shared hosts and SPA/query employers get distinct context keys without truncation or legacy origin fallback', () => {
  const urls = ['https://shared.example.invalid/employers/A/apply', 'https://shared.example.invalid/employers/B/apply', 'https://shared.example.invalid/?employer=A', 'https://shared.example.invalid/?employer=B', 'https://shared.example.invalid/#/A', 'https://shared.example.invalid/#/B'];
  assert.equal(new Set(urls.map(core.portalContext)).size, urls.length);
  const prefix = `https://shared.example.invalid/${'x'.repeat(400)}`;
  assert.notEqual(core.portalContext(prefix + '/A'), core.portalContext(prefix + '/B'));
  assert.notEqual(core.portalContext(urls[0]), new URL(urls[0]).origin);
  assert.equal(core.portalContext(urls[0] + '?utm_source=fixture'), core.portalContext(urls[0]));
});

test('form polling counts placeholders and independent radio groups without changing existing IDs or draft markers', () => {
  const body = {};
  function element(tag, attrs = {}) {
    const attributes = { ...attrs };
    return { tagName: tag.toUpperCase(), type: attrs.type || '', value: '', disabled: false, readOnly: false, parentElement: body, previousElementSibling: null, id: '', attributes,
      classList: { contains: () => false }, getBoundingClientRect: () => ({ width: 100, height: 24 }), getAttribute: (key) => attributes[key] ?? null, hasAttribute: (key) => key in attributes,
      setAttribute: (key, value) => { attributes[key] = value; }, removeAttribute: (key) => { delete attributes[key]; },
      closest: () => null, querySelector: () => null, querySelectorAll: () => [], matches: (selector) => selector === 'input' && tag === 'input', contains: (other) => other === this,
    };
  }
  const selects = Array.from({ length: 3 }, (_, i) => {
    const el = element('select', { 'aria-label': '学校', 'data-cp-fill-id': `existing-${i}`, 'data-cp-answer-id': 'draft' });
    el.value = '0'; el.selectedIndex = 0; el.options = [{ value: '0', textContent: '请选择', disabled: false }, { value: 'school', textContent: '虚构大学', disabled: false }]; return el;
  });
  const radios = [];
  for (let i = 0; i < 2; i++) {
    const group = [element('input', { type: 'radio', name: 'gender', 'aria-label': '性别' }), element('input', { type: 'radio', name: 'gender', 'aria-label': '性别' })];
    const form = { querySelectorAll: () => group }; group.forEach((el, j) => { el.form = form; el.value = ['男', '女'][j]; }); radios.push(...group);
  }
  const combo = element('input', { role: 'combobox', readonly: '', 'aria-label': '学历' }); combo.readOnly = true;
  const all = [...selects, ...radios, combo];
  const document = { body, querySelector: () => null, getElementById: () => null, querySelectorAll: (selector) => selector.startsWith('.ant-select') ? [combo] : selector === '[data-cp-fill-id]' ? selects : all };
  const context = { module: { exports: {} }, URL, URLSearchParams, document, window: { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) }, location: { href: 'https://fixture.example.invalid/#/step2' } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/autofill-core.js'), 'utf8'), context);
  const before = JSON.stringify(all.map((el) => el.attributes));
  assert.equal(context.module.exports.countFillableFields().count, 6);
  assert.equal(JSON.stringify(all.map((el) => el.attributes)), before);
  selects[0].selectedIndex = 1; selects[0].value = 'school'; radios[0].checked = true;
  assert.equal(context.module.exports.countFillableFields().count, 4);
});

test('background jobs obey current switches, avoid overlap and retry failures within 15 minutes', async () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const start = source.indexOf('let scanTimer = null;'), end = source.indexOf('// 自动备份 (settings', start);
  let now = 100000000, calls = 0, fail = true, release, started;
  const settings = { backgroundReminders: false, inboxScanIntervalHours: 1, jobRadarIntervalHours: 6, applicationSyncIntervalHours: 6 };
  const context = vm.createContext({ readAppSettings: () => settings, createApplicationSyncSchedule: require('../electron/application-sync-schedule').createApplicationSyncSchedule, AbortController, AbortSignal, PORT: 3210, Date: { now: () => now },
    require: () => ({ Notification: { isSupported: () => false } }), fetch: async () => { calls++; if (started) { started(); await new Promise((r) => { release = r; }); } return { ok: true, json: async () => fail ? { ok: false, error: 'fixture', errors: [{ message: 'fixture' }] } : { ok: true, changed: [], errors: [] } }; }, showWindow() {} });
  // Schedules use the controlled clock too.
  context.createApplicationSyncSchedule = () => {
    const sandbox = { module: { exports: {} }, Date: { now: () => now } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/application-sync-schedule.js'), 'utf8'), sandbox);
    return sandbox.module.exports.createApplicationSyncSchedule();
  };
  vm.runInContext(source.slice(start, end), context);
  await context.maybeScanInbox(); await context.maybeCheckJobRadar(); await context.maybeSyncApplications(); assert.equal(calls, 0);
  settings.backgroundReminders = true;
  let announce; const signal = new Promise((r) => { announce = r; }); started = announce;
  const pending = context.maybeScanInbox(); await signal; await context.maybeScanInbox(); assert.equal(calls, 1);
  started = null; release(); await pending;
  now += 5 * 60000; await context.maybeScanInbox(); assert.equal(calls, 1);
  now += 10 * 60000; fail = false; await context.maybeScanInbox(); assert.equal(calls, 2);
  now += 15 * 60000; await context.maybeScanInbox(); assert.equal(calls, 2);
  fail = true; await context.maybeCheckJobRadar(); await context.maybeSyncApplications(); assert.equal(calls, 4);
  now += 15 * 60000; fail = false; await context.maybeCheckJobRadar(); await context.maybeSyncApplications(); assert.equal(calls, 6);
  settings.backgroundReminders = false; now += 7 * 3600000;
  await context.maybeScanInbox(); await context.maybeCheckJobRadar(); await context.maybeSyncApplications(); assert.equal(calls, 6);
  await context.maybeScanInbox(true); assert.equal(calls, 7, 'explicit tray action remains available');
});

test('settings reconciliation immediately starts/stops timers and aborts old requests, including interval changes', () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const start = source.indexOf('let settingsTimer = null;'), end = source.indexOf('let isQuitting', start);
  let settings = { autoLaunch: true, notesAtLogin: false, backgroundReminders: true, inboxScanIntervalHours: 1, jobRadarIntervalHours: 6, applicationSyncIntervalHours: 6 };
  let launches = [], started = 0, stopped = 0, aborted = 0, resets = 0;
  const context = vm.createContext({ readAppSettings: () => settings, process: { env: {} }, applyAutoLaunch: (enabled) => launches.push(enabled),
    backgroundRequests: new Map([['inbox', { abort() { aborted++; } }]]), inboxSchedule: { reset() { resets++; } }, radarSchedule: { reset() { resets++; } }, applicationSyncSchedule: { reset() { resets++; } },
    reminderTimer: null, scanTimer: null, clearInterval: () => { stopped++; }, startReminderLoop: () => { if (!context.reminderTimer) { context.reminderTimer = 1; started++; } }, startScanLoop: () => { if (!context.scanTimer) { context.scanTimer = 2; started++; } } });
  vm.runInContext(source.slice(start, end), context); context.reconcileAppSettings();
  assert.equal(started, 2); assert.deepEqual(launches, [true]);
  settings = { ...settings, inboxScanIntervalHours: 2 }; context.reconcileAppSettings(); assert.equal(resets, 4); assert.equal(aborted, 2);
  settings = { ...settings, backgroundReminders: false }; context.reconcileAppSettings(); assert.equal(stopped, 2); assert.equal(aborted, 3); assert.deepEqual(launches, [true, false]);
  settings = { ...settings, notesAtLogin: true }; context.reconcileAppSettings(); assert.deepEqual(launches, [true, false, true]);
});

test('streaming backup route authenticates loopback/origin before reading and cancels oversize streams', async () => {
  let auth = 0, reads = 0, cancelled = 0, released = 0;
  class Response { constructor(_body, init) { this.status = init.status; } static json(data, init) { return { data, status: init?.status ?? 200 }; } }
  const load = loader({ 'next/server': { NextResponse: Response }, '@/lib/session': { requireUser: async () => { auth++; } }, '@/lib/actions/backup': { previewBackup: async () => ({ ok: true }), importBackup: async () => ({ ok: true }) } });
  const { POST } = load('src/app/api/data-transfer/route.ts');
  const make = (headers, value) => ({ url: 'http://localhost:3210/api/data-transfer?mode=preview', headers: new Headers(headers), body: { getReader: () => ({ read: async () => { reads++; return { done: false, value }; }, cancel: async () => { cancelled++; }, releaseLock: () => { released++; } }) } });
  assert.equal((await POST(make({ host: 'rebind.example.invalid' }, null))).status, 403);
  assert.equal((await POST(make({ host: 'localhost:3210', origin: 'https://external.example.invalid' }, null))).status, 403);
  assert.equal(auth, 0); assert.equal(reads, 0);
  const max = 256 * 1024 * 1024;
  assert.equal((await POST(make({ host: 'localhost:3210', 'content-length': String(max + 1) }, null))).status, 413); assert.equal(reads, 0);
  assert.equal((await POST(make({ host: 'localhost:3210' }, { length: max + 1 }))).status, 413);
  assert.equal(cancelled, 1); assert.equal(released, 1);
});
