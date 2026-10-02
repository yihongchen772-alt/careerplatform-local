const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient } = require('@prisma/client');
const core = require('../electron/autofill-core.js');
function load(file, mocks = {}) {
  const mod = { exports: {} }; const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => mocks[id] || (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Buffer, URL, Intl, process }); return mod.exports;
}
function fillFixture() {
  let plan, active = true; const writes = []; let uploads = 0;
  const fields = [{ id: 'f0', mappingKey: 'school-0', label: '学校', section: '教育经历', tag: 'input', hasValue: false }, { id: 'f1', mappingKey: 'essay', label: '为什么申请本岗位？', tag: 'textarea', hasValue: false, maxLength: 10 }, { id: 'f2', label: '邮箱', tag: 'input', hasValue: true }];
  const adapter = { taskId: 'fixture', url: () => 'https://fixture.example/apply', stillOnPage: () => active, frames: async () => [0], getPlan: () => plan, setPlan: (value) => { plan = value; }, getDrafts: () => [], setDrafts() {}, status() {},
    uploadResume: async () => { uploads++; return 1; },
    api: async (name) => ({ ok: true, json: async () => name.startsWith('profile') ? { email: 'fixture@example.invalid', education: [{ school: '大学甲' }, { school: '大学乙' }] } : name === 'answer-questions' ? { answers: [{ id: 'f1', answer: '岗位匹配', answerId: 'answer' }] } : null }),
    run: async (_frame, fn, args) => { if (fn === core.scanPageFields) return structuredClone(fields); if (fn === core.fillFields) { writes.push(...args[0]); return { filled: args[0].filter((p) => p.id !== 'f0').map((p) => p.id), skipped: args[0].filter((p) => p.id === 'f0').map((p) => p.id), failed: [] }; } if (fn === core.validatePageFields) return []; },
  };
  return { adapter, writes, fields, plan: () => plan, uploads: () => uploads, move: () => { active = false; } };
}
test('preview makes no writes; AI needs selection; explicit row mapping still preserves later edits', async () => {
  const f = fillFixture(); const preview = await core.runAutofillCore(f.adapter, 'resume', { mode: 'preview', positionId: 'job', modules: ['education', 'questions', 'resume'] });
  assert.equal(preview.phase, 'preview'); assert.equal(f.writes.length, 0); assert.equal(f.uploads(), 0);
  assert.equal(preview.plan.proposals.find((p) => p.id === 'f1').selected, false); assert.equal(preview.plan.proposals.find((p) => p.id === 'f2').eligible, false);
  const result = await core.applyAutofillPlan(f.adapter, { planId: preview.plan.id, approved: [{ id: 'f0', ref: 'education.1.school', value: '' }, { id: 'f1', value: '改成我的回答' }, { id: 'f2', value: 'cannot overwrite' }], uploadResume: false });
  assert.equal(result.phase, 'done'); assert.equal(result.summary.preserved, 2); assert.equal(result.summary.filled, 1);
  assert.equal(f.writes.find((p) => p.id === 'f0').value, '大学乙'); assert.equal(f.writes.some((p) => p.id === 'f2'), false); assert.equal(f.uploads(), 0);
});
test('expired, navigated, or oversize preview cannot write or attach files', async () => {
  for (const condition of ['expired', 'navigated', 'oversize']) { const f = fillFixture(); await core.runAutofillCore(f.adapter, 'resume', { mode: 'preview' }); if (condition === 'expired') f.plan().at = 0; if (condition === 'navigated') f.move(); const result = await core.applyAutofillPlan(f.adapter, { planId: 'fixture', approved: [{ id: 'f1', value: condition === 'oversize' ? 'x'.repeat(11) : 'ok' }], uploadResume: true }); assert.equal(result.phase, 'error'); assert.equal(f.writes.length, 0); assert.equal(f.uploads(), 0); }
});
test('preview survives scanner IDs changing; rewrites preserve manual drafts but regenerate unedited suggestions', async () => {
  const f = fillFixture(); f.fields.forEach((field) => { field.resultKey = field.mappingKey || field.id; });
  let preview = await core.runAutofillCore(f.adapter, 'resume', { mode: 'preview' });
  const edits = preview.plan.proposals.map((p) => ({ ...p, ...(p.id === 'f0' ? { value: '手动学校', ref: '', edited: true } : {}) }));
  preview = await core.runAutofillCore(f.adapter, 'resume', { mode: 'preview', regenerate: true, previewEdits: edits });
  assert.equal(preview.plan.proposals.find((p) => p.id === 'f0').value, '手动学校');
  f.fields.forEach((field) => { field.id = `live-${field.id}`; });
  const applied = await core.applyAutofillPlan(f.adapter, { planId: preview.plan.id, approved: [{ id: 'f1', value: '核对答案' }] });
  assert.equal(applied.phase, 'done'); assert.equal(f.writes[0].id, 'live-f1');
});
test('job AI prompt includes saved JD and length; JD/profile changes invalidate only generated cache; rewrite forces regeneration', async () => {
  let jd = '要求 SQL 与数据建模'; let calls = 0; let lastPrompt = ''; const rows = [];
  const mocks = { 'next/server': { NextResponse: { json: (body, options = {}) => ({ status: options.status || 200, json: async () => body }) } }, '@/lib/session': { requireUser: async () => ({ id: 'user' }) }, '@/lib/db': { db: { position: { findFirst: async () => ({ id: 'job', title: '分析工程师', company: { name: '虚构企业' }, jdText: jd }) }, resumeVersion: { findFirst: async () => ({ fileUrl: '/api/files/resume.pdf', extractedText: '候选人有 SQL 项目经验' }) }, autofillAnswer: { findMany: async () => rows, create: async ({ data }) => { const row = { ...data, id: String(rows.length), confirmed: false }; rows.unshift(row); return row; } } } }, '@/lib/gemini': {}, '@/lib/ai-file-search': {}, '@/lib/resume-extract': {}, '@/lib/ai-providers': { getUserAiConfig: async () => ({ provider: 'fixture' }), callTextAi: async ({ prompt }) => { calls++; lastPrompt = prompt; return { answers: [{ id: 'q', answer: '有相关经验' }] }; } } };
  const route = load('src/app/api/desktop-browser/answer-questions/route.ts', mocks);
  const body = { positionId: 'job', resumeVersionId: 'resume', answerLength: 100, profile: { targetRole: '数据工程' }, questions: [{ id: 'q', label: '为什么申请这个岗位？', kind: 'essay', maxLength: 20 }] };
  const request = async (extra = {}) => (await route.POST({ json: async () => ({ ...body, ...extra }) })).json();
  await request(); assert.equal(calls, 1); assert.match(lastPrompt, /虚构企业/); assert.match(lastPrompt, /SQL 与数据建模/); assert.match(lastPrompt, /100 字/); assert.match(lastPrompt, /最多 20 字/);
  assert.equal((await request()).answers[0].reused, true); assert.equal(calls, 1);
  jd = '要求数据仓库'; await request(); assert.equal(calls, 2);
  await request({ profile: { targetRole: '数据仓库工程' } }); assert.equal(calls, 3);
  await request({ regenerate: true }); assert.equal(calls, 4);
  assert.equal((await request({ questions: [{ ...body.questions[0], maxLength: 2 }], regenerate: true })).answers.length, 0);
});
test('malformed imported material and checklist JSON fall back safely', () => {
  assert.equal(load('src/lib/submission-package.ts').parseSubmissionPackage({ fields: 'invalid' }), null);
  assert.equal(load('src/lib/application-workflow.ts').parseWorkflowChecklist({ APPLIED: ['invalid'] }), null);
});
test('snapshot capture works when CSP forbids dynamic functions and survives leaving the form', () => {
  const storage = new Map(); const listeners = {}; let onForm = true;
  const field = { type: 'text', value: '原回答', tagName: 'TEXTAREA', getBoundingClientRect: () => ({ width: 100 }), getAttribute: () => '申请理由', closest: () => null };
  const context = vm.createContext({ window: { addEventListener: (event, callback) => { listeners[event] = callback; } }, document: { querySelectorAll: () => onForm ? [field] : [], addEventListener: (event, callback) => { listeners[event] = callback; } }, sessionStorage: { setItem: (key, value) => storage.set(key, value), getItem: (key) => storage.get(key), removeItem: (key) => storage.delete(key) }, location: { href: 'https://fixture.example/apply' }, Date, Set, Function: function () { throw new Error('CSP unsafe-eval blocked'); } });
  vm.runInContext(`(${core.readCurrentApplicationFields.toString()})()`, context);
  assert.equal(vm.runInContext(`(${core.watchApplicationFields.toString()})("job:v1:fixture")`, context), true);
  field.value = '最终人工回答'; listeners.submit(); onForm = false;
  vm.runInContext(`(${core.readCurrentApplicationFields.toString()})()`, context);
  const fields = vm.runInContext(`(${core.collectApplicationFields.toString()})("job:v1:fixture")`, context);
  assert.equal(fields[0].value, '最终人工回答');
  assert.equal(vm.runInContext(`(${core.collectApplicationFields.toString()})("job:v1:another")`, context).length, 0);
});
test('calendar wall time rejects impossible and ambiguous dates; invites preserve stated time zone', () => {
  const { confirmedWallTime, parseCalendarInvite } = load('src/lib/mail-calendar.ts');
  assert.equal(confirmedWallTime('2026-10-05T09:30', 'Asia/Shanghai').toISOString(), '2026-10-05T01:30:00.000Z');
  assert.throws(() => confirmedWallTime('2026-02-30T09:00', 'UTC'));
  assert.throws(() => confirmedWallTime('2026-03-08T02:30', 'America/New_York'));
  assert.throws(() => confirmedWallTime('2026-11-01T01:30', 'America/New_York'));
  const invite = parseCalendarInvite('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:技术面试\r\nDTSTART;TZID=Asia/Shanghai:20261005T093000\r\nDTEND;TZID=Asia/Shanghai:20261005T103000\r\nLOCATION:线上\r\nEND:VEVENT\r\nEND:VCALENDAR');
  assert.equal(invite.localStart, '2026-10-05T09:30'); assert.equal(invite.timeZone, 'Asia/Shanghai');
  assert.equal(parseCalendarInvite('BEGIN:VEVENT\nDTSTART:20261005T093000\nEND:VEVENT').timeZone, '');
});
test('ICS escapes injected lines, folds UTF-8 safely, and exports all-day end exclusively', () => {
  const { buildCalendarIcs } = load('src/lib/calendar-export.ts'); const text = buildCalendarIcs([{ id: 'id', title: '面试'.repeat(60) + '\nBEGIN:VALARM', description: 'a;b,c', startsAt: new Date('2026-10-05T00:00:00Z'), allDay: true, dateKey: '2026-10-05', offsetMinutes: 30 }]);
  assert.ok(text.includes('DTEND;VALUE=DATE:20261006')); assert.ok(text.includes('a\\;b\\,c')); assert.ok(text.includes('TRIGGER:-PT30M'));
  assert.equal(text.split('\r\n').filter((l) => l === 'BEGIN:VALARM').length, 1); for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
});
test('isolated DB: confirmed package is immutable, duplicate creation rolls back files; workflow/rules reject stale revisions; mail confirmation is idempotent', async (t) => {
  const parent = path.resolve(__dirname, '../.local-run/workspace-tests'); fs.mkdirSync(parent, { recursive: true }); const root = fs.mkdtempSync(path.join(parent, 'case-')); const file = path.join(root, 'fixture.db'); const sql = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.resolve(__dirname, '../prisma/migrations')).filter((s) => /^\d/.test(s)).sort()) sql.exec(fs.readFileSync(path.resolve(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8')); sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll('\\', '/')}` } } }); t.after(async () => { await db.$disconnect(); fs.rmSync(root, { recursive: true, force: true }); });
  await db.user.create({ data: { id: 'local-user', email: 'fixture@local', name: '虚构候选人', applicationProfile: { education: [{ school: '虚构大学' }] } } });
  await db.company.create({ data: { id: 'company', name: '虚构企业' } }); await db.position.create({ data: { id: 'job', userId: 'local-user', companyId: 'company', title: '虚构岗位', jdText: '原岗位要求' } });
  fs.writeFileSync(path.join(root, 'resume.pdf'), 'fixture-pdf'); await db.resumeVersion.create({ data: { id: 'resume', userId: 'local-user', name: '原简历', fileUrl: '/api/files/resume.pdf' } });
  let copyId = 0; const mocks = { '@/lib/db': { db }, '@/lib/session': { requireUser: () => db.user.findUniqueOrThrow({ where: { id: 'local-user' } }) }, 'next/cache': { revalidatePath() {} }, '@/lib/ai-providers': {}, '@/lib/company-resolver': { resolveCompanyId: async () => 'company' }, '@/lib/local-storage': { localPathForStoredUrl: (url) => path.join(root, path.basename(url)), mimeTypeForExtension: () => 'application/pdf', saveLocalFile: async (buffer) => { const name = `copy-${++copyId}.pdf`; fs.writeFileSync(path.join(root, name), buffer); return { url: `/api/files/${name}`, filename: name }; }, deleteLocalFileByUrl: async (url) => fs.rmSync(path.join(root, path.basename(url)), { force: true }) } };
  const record = load('src/lib/actions/submitted-application.ts', mocks); const input = { companyName: '虚构企业', title: '虚构岗位', positionId: 'job', resumeVersionId: 'resume', applyUrl: 'https://fixture.example/success', appliedDate: new Date(), snapshot: { url: 'https://fixture.example/apply', fields: [{ label: '最终回答', value: '用户修改的回答' }, { label: '验证码', value: 'secret' }], positionId: 'job', resumeVersionId: 'resume' } };
  await db.applicationDraft.create({ data: { userId: 'local-user', contextKey: 'job:v1:job', url: input.applyUrl, name: '未提交草稿', content: {} } });
  const app = await record.recordSubmittedApplication(input); assert.equal(await db.application.count(), 1); assert.equal(await db.applicationDraft.count(), 0); const saved = await db.application.findUniqueOrThrow({ where: { id: app.id } }); assert.equal(saved.submissionPackage.fields.length, 1);
  const attachment = await db.attachment.findUniqueOrThrow({ where: { id: saved.submissionPackage.resumeAttachmentId } }); assert.equal(fs.readFileSync(path.join(root, path.basename(attachment.url)), 'utf8'), 'fixture-pdf');
  await db.resumeVersion.update({ where: { id: 'resume' }, data: { name: '新简历' } }); await db.position.update({ where: { id: 'job' }, data: { jdText: '新要求' } }); assert.equal(saved.submissionPackage.jd, '原岗位要求'); assert.equal(saved.submissionPackage.resumeName, '原简历');
  await assert.rejects(record.recordSubmittedApplication(input), /已经记录/); assert.equal(fs.existsSync(path.join(root, 'copy-2.pdf')), false); assert.equal(await db.application.count(), 1);
  const workflow = load('src/lib/actions/application-workflow.ts', mocks); const first = await workflow.saveApplicationWorkflow({ applicationId: app.id, stage: 'APPLIED', revision: 0, items: [{ id: 'one', title: '跟进', dueDate: '2026-10-10', done: false }] }); assert.equal(first.ok, true); const taskId = first.data.items[0].taskId;
  assert.equal((await workflow.saveApplicationWorkflow({ applicationId: app.id, stage: 'APPLIED', revision: 0, items: [] })).ok, false); assert.equal(await db.personalTask.count(), 1);
  const second = await workflow.saveApplicationWorkflow({ applicationId: app.id, stage: 'APPLIED', revision: 1, items: [{ ...first.data.items[0], done: true }] }); assert.equal(second.ok, true); assert.equal((await db.personalTask.findUniqueOrThrow({ where: { id: taskId } })).done, true);
  const rules = load('src/lib/actions/application-rules.ts', mocks); const ruleInput = load('src/lib/application-rules.ts').applicationRulesSchema.parse({ maxPositions: 2 }); assert.equal((await rules.saveApplicationRules('job', 0, ruleInput)).ok, true); assert.equal((await rules.saveApplicationRules('job', 0, ruleInput)).ok, false);
  const draft = { title: '虚构面试', localStart: '2026-10-10T14:00', localEnd: '', timeZone: 'Asia/Shanghai', location: '线上', meetingUrl: 'https://fixture.example/meeting', evidence: '邮件写明 10月10日14点' }; const task = await db.personalTask.create({ data: { userId: 'local-user', title: '面试通知', mailEventDraft: draft } }); const calendar = load('src/lib/actions/mail-calendar.ts', mocks);
  const a = await calendar.confirmMailCalendar(task.id, draft, 30); const b = await calendar.confirmMailCalendar(task.id, draft, 30); assert.equal(a.ok, true); assert.equal(b.data.existing, true); assert.equal(a.data.id, b.data.id); assert.equal(await db.calendarEvent.count(), 1); assert.equal(await db.eventReminder.count(), 1);
});
