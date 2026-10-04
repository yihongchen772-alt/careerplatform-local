const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient } = require('@prisma/client');
const core = require('../electron/autofill-core.js');
const root = path.resolve(__dirname, '..');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-memory-'));
  const file = path.join(dir, 'test.db');
  const sql = new DatabaseSync(file);
  for (const migration of fs.readdirSync(path.join(root, 'prisma/migrations')).filter((name) => /^\d/.test(name)).sort()) sql.exec(fs.readFileSync(path.join(root, 'prisma/migrations', migration, 'migration.sql'), 'utf8'));
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  await db.user.create({ data: { id: 'fixture', email: 'fixture@example.invalid' } });
  const mocks = { '@/lib/db': { db }, '@/lib/session': { requireUser: () => db.user.findUniqueOrThrow({ where: { id: 'fixture' } }) }, 'next/cache': { revalidatePath() {} }, 'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status || 200 }) } } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => mocks[id] || (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : require(id)), console, Date, Error, URL, URLSearchParams, Buffer, process });
    cache.set(file, mod.exports); return mod.exports;
  }
  t.after(async () => { await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  const route = load('src/app/api/desktop-browser/save-corrections/route.ts');
  const post = (records, extra = {}) => route.POST({ json: async () => ({ resumeVersionId: null, contextKey: 'page:v2:https://company-one.example/apply', sourceUrl: 'https://company-one.example/apply?token=private', records, ...extra }) });
  // Existing storage tests exercise the legacy merge helper directly. The
  // browser route below is separately tested through explicit review.
  const remember = async (records, extra = {}) => {
    const { memoryCaptureSchema, memorySourceUrl } = load('src/lib/application-memory.ts');
    const captures = records.map((record) => memoryCaptureSchema.parse(record));
    const result = await db.$transaction((tx) => load('src/lib/application-memory-store.ts').storeApplicationMemories(tx, 'fixture', captures, memorySourceUrl(extra.sourceUrl || 'https://company-one.example/apply?token=private')));
    return { data: { saved: result.changed, recordsSaved: result.changed, processed: records.length, unchanged: records.length - result.changed } };
  };
  const actions = load('src/lib/actions/pending-application-change.ts');
  const review = async (row, choice = {}) => actions.acceptPendingApplicationChange(row.id, { revision: row.revision, ...choice });
  return { db, load, post, remember, review, actions };
}

test('capture is idempotent, cross-site sources are compact, and date typography does not create another project/version', async (t) => {
  const { db, remember: post, load } = await fixture(t);
  const item = { category: 'project', content: { name: '招聘数据看板', role: '负责人', start: '2025.01', description: '整理数据并制作看板' } };
  assert.equal((await post([item])).data.recordsSaved, 1);
  const first = await db.applicationMemory.findFirst();
  const repeated = (await post([item])).data;
  assert.equal(repeated.saved, 0); assert.equal(repeated.processed, 1); assert.equal(repeated.unchanged, 1);
  assert.equal((await db.applicationMemory.findFirst()).revision, first.revision);
  await post([{ ...item, captureKey: 'new-document', content: { ...item.content, start: '2025-01-01' } }], { sourceUrl: 'https://company-two.example/apply?resume=secret' });
  const row = await db.applicationMemory.findFirst();
  assert.equal(await db.applicationMemory.count(), 1); assert.equal(row.alternatives.length, 0); assert.equal(row.sources.length, 2);
  assert.ok(row.sources.every((source) => !source.url.includes('?')));
  const profile = (await load('src/app/api/desktop-browser/profile/route.ts').GET({ url: 'http://localhost/api/profile' })).data;
  assert.equal(profile.projects.length, 1); assert.equal(profile.projects[0].description, item.content.description);
});

test('different descriptions keep one entity and selectable versions; different dated internships remain separate', async (t) => {
  const { db, remember: post, load } = await fixture(t);
  const item = { category: 'experience', content: { company: '虚构企业', role: '数据实习生', start: '2025-06', description: '原始描述' } };
  await post([item]); await post([{ ...item, content: { ...item.content, description: '针对其他岗位的描述' } }]);
  await post([{ ...item, content: { ...item.content, description: '针对其他岗位的描述' } }]);
  let row = await db.applicationMemory.findFirst();
  assert.equal(row.content.description, '原始描述'); assert.equal(row.alternatives.length, 1); assert.equal(await db.applicationMemory.count(), 1);
  const actions = load('src/lib/actions/application-memory.ts');
  const stale = await actions.updateApplicationMemory(row.id, row.revision - 1, { content: row.alternatives[0].content, enabled: true });
  assert.equal(stale.ok, false);
  assert.equal((await actions.updateApplicationMemory(row.id, row.revision, { content: row.alternatives[0].content, enabled: true })).ok, true);
  row = await db.applicationMemory.findFirst(); assert.equal(row.content.description, '针对其他岗位的描述');
  assert.equal(row.alternatives[0].content.description, '原始描述');
  await post([{ ...item, content: { ...item.content, start: '2026-06' } }]);
  assert.equal(await db.applicationMemory.count(), 2);
});

test('completing a partial identity does not later attach an undated capture to an arbitrary dated experience', async (t) => {
  const { db, remember: post } = await fixture(t);
  const item = { category: 'project', content: { name: '同名项目', description: '已写的描述' } };
  await post([item]); await post([{ ...item, content: { ...item.content, start: '2025-06' } }]);
  assert.equal(await db.applicationMemory.count(), 1);
  assert.ok((await db.applicationMemory.findFirst()).identity.includes('2025-06'));
  await post([{ ...item, content: { ...item.content, start: '2026-06' } }]);
  await post([{ ...item, content: { ...item.content, description: '没有日期的新内容' } }]);
  assert.equal(await db.applicationMemory.count(), 3);
  assert.ok((await db.applicationMemory.findMany()).filter((row) => row.content.start).every((row) => row.content.description === '已写的描述'));
});

test('manual profile facts win; direction variants retain selected projects; disabling a memory prevents automatic reuse', async (t) => {
  const { db, remember: post, load } = await fixture(t);
  await post([{ category: 'project', content: { name: '手动项目', description: '网站描述', responsibilities: '明确职责' } }, { category: 'award', content: { name: '省级竞赛一等奖', level: '省级', date: '2025-09' } }]);
  await db.user.update({ where: { id: 'fixture' }, data: { applicationProfile: { projects: [{ name: '手动项目', description: '资料中手动维护的描述' }], variants: [{ id: 'direction', name: '产品', projects: [{ name: '方向项目' }] }] } } });
  const route = load('src/app/api/desktop-browser/profile/route.ts');
  let profile = (await route.GET({ url: 'http://localhost/profile' })).data;
  assert.equal(profile.projects.length, 1); assert.equal(profile.projects[0].description, '资料中手动维护的描述'); assert.equal(profile.projects[0].responsibilities, '明确职责');
  profile = (await route.GET({ url: 'http://localhost/profile?variantId=direction' })).data;
  assert.deepEqual(Array.from(profile.projects, (row) => row.name), ['方向项目']); assert.equal(profile.awards.length, 1); assert.equal(profile.library.length, 2);
  const award = await db.applicationMemory.findFirst({ where: { category: 'award' } });
  const actions = load('src/lib/actions/application-memory.ts'); await actions.updateApplicationMemory(award.id, award.revision, { content: award.content, enabled: false });
  profile = (await route.GET({ url: 'http://localhost/profile' })).data; assert.equal(profile.awards.length, 0);
});

test('flat answers deduplicate without merging opposite questions or company scopes; tidy removes only identical confirmed rows', async (t) => {
  const { db, post, load, review } = await fixture(t);
  const answers = [{ questionLabel: '姓名', answer: '虚构姓名', kind: 'field' }];
  assert.equal((await post([], { answers })).data.pending, 1);
  assert.equal((await review(await db.pendingApplicationChange.findFirst(), { shareAcrossCompanies: true })).ok, true);
  assert.equal((await post([], { answers })).data.saved, 0);
  await post([], { answers: [{ questionLabel: '是否接受调剂？', answer: '接受', kind: 'short' }, { questionLabel: '是否不接受调剂？', answer: '不接受', kind: 'short' }] });
  for (const row of await db.pendingApplicationChange.findMany({ where: { status: 'pending' } })) assert.equal((await review(row)).ok, true);
  await post([], { contextKey: 'page:v2:https://company-two.example/apply', answers: [{ questionLabel: '姓名', answer: '其他名字', kind: 'field' }] });
  assert.equal((await review(await db.pendingApplicationChange.findFirst({ where: { status: 'pending' } }))).ok, true);
  assert.equal(await db.autofillAnswer.count(), 4);
  const global = await db.autofillAnswer.findFirst({ where: { contextKey: null, questionLabel: '姓名' } }); assert.equal(global.answer, '虚构姓名');
  const { id: _id, createdAt: _created, updatedAt: _updated, ...copy } = global;
  await db.autofillAnswer.create({ data: copy });
  const tidy = await load('src/lib/actions/autofill-memory.ts').tidyAutofillMemories(); assert.equal(tidy.ok, true); assert.equal(tidy.data.length, 1); assert.equal(await db.autofillAnswer.count(), 4);
});

test('browser discoveries stay pending until reviewed, then use the chosen reuse scope', async (t) => {
  const { db, post, load } = await fixture(t);
  const answer = { questionLabel: '为什么选择这家公司？', answer: '因为岗位方向与我的经历匹配。', kind: 'essay' };
  const record = { category: 'project', content: { name: '待确认项目', description: '这是本次申请中补写的描述' } };
  const staged = (await post([record], { mode: 'stage', answers: [answer] })).data;
  assert.equal(staged.pending, 2);
  assert.equal(await db.pendingApplicationChange.count(), 2);
  assert.equal(await db.autofillAnswer.count(), 0, 'pending answers must not become reusable');
  assert.equal(await db.applicationMemory.count(), 0, 'pending experiences must not enter the profile');

  const actions = load('src/lib/actions/pending-application-change.ts');
  const pending = await db.pendingApplicationChange.findMany({ orderBy: { kind: 'asc' } });
  const pendingAnswer = pending.find((row) => row.kind === 'answer');
  const pendingRecord = pending.find((row) => row.kind === 'record');
  assert.equal((await actions.acceptPendingApplicationChange(pendingAnswer.id, { revision: pendingAnswer.revision, shareAcrossCompanies: false })).ok, true);
  const savedAnswer = await db.autofillAnswer.findFirst();
  assert.equal(savedAnswer.contextKey, 'page:v2:https://company-one.example/apply');
  assert.equal(savedAnswer.confirmed, true);
  assert.equal((await actions.acceptPendingApplicationChange(pendingRecord.id, { revision: pendingRecord.revision, shareAcrossCompanies: false })).ok, true);
  assert.equal(await db.applicationMemory.count(), 1);
  assert.equal(await db.pendingApplicationChange.count({ where: { status: 'pending' } }), 0);
  assert.equal((await db.applicationMemory.findFirst()).enabled, false, 'newly reviewed records are manual choices until automatic reuse is explicitly selected');

  await post([{ ...record, content: { ...record.content, description: '准备设为默认的新描述' } }], { mode: 'stage' });
  const replacement = await db.pendingApplicationChange.findFirst({ where: { status: 'pending' } });
  const target = await db.applicationMemory.findFirst();
  assert.equal((await actions.acceptPendingApplicationChange(replacement.id, { revision: replacement.revision, target: { id: target.id, revision: target.revision }, shareAcrossCompanies: false, recordPreference: 'replace' })).ok, true);
  const updated = await db.applicationMemory.findFirst();
  assert.equal(updated.content.description, '准备设为默认的新描述');
  assert.equal(updated.alternatives[0].content.description, '这是本次申请中补写的描述');
});

test('sparse repeated blocks use one record; existing anchors reorder rows; unmatched projects and missing descriptions never go to AI', () => {
  const profile = { projects: [{ name: '甲项目', role: '负责人', description: '甲描述' }, { name: '乙项目', role: '开发', description: '乙描述' }] };
  const field = (id, blockKey, label, extra = {}) => ({ id, blockKey, label, section: '项目经历', tag: 'input', ...extra });
  const fields = [field('a-name', 'a', '项目名称', { hasValue: true, currentValue: '乙项目' }), field('a-role', 'a', '项目角色'), field('b-name', 'b', '项目名称'), field('b-desc', 'b', '项目描述', { tag: 'textarea' })];
  const { repeats } = core.classifyRepeatBlocks(fields, profile);
  assert.equal(core.repeatFieldValue(fields[1], repeats.get('a-role'), profile), '开发');
  assert.equal(core.repeatFieldValue(fields[3], repeats.get('b-desc'), profile), '甲描述');
  fields[0].currentValue = '未收录项目';
  const unmatched = core.classifyRepeatBlocks(fields, profile).repeats.get('a-role'); assert.equal(core.repeatFieldValue(fields[1], unmatched, profile), null); assert.equal(core.repeatFieldGoesToAi(unmatched, profile), false);
  assert.equal(core.resolveRepeatField({ label: '你在项目中遇到什么挑战？', tag: 'textarea' }, new Map()), null);
  assert.equal(core.experienceFieldKind('岗位职责', true, '岗位职责'), 'description');
  const refs = core.profileChoices(profile).map((choice) => choice.ref);
  assert.deepEqual(new Set(refs), new Set(core.profileChoices({ projects: [...profile.projects].reverse() }).map((choice) => choice.ref)), 'reordering a profile must not repoint a remembered source');
  const blank = [field('empty-name', 'empty', '项目名称', { mappingKey: 'name-key' }), field('empty-role', 'empty', '项目角色')];
  const mapped = { ...profile, mappings: [{ fieldKey: 'name-key', ref: `${core.recordReference('project', profile.projects[0])}:name` }] };
  const classified = core.classifyRepeatBlocks(blank, mapped);
  assert.equal(core.repeatFieldValue(blank[1], classified.repeats.get('empty-role'), mapped), '负责人');
  assert.equal(core.previewRecordBlocks(classified.blocks, classified.repeats, mapped)[0].choices[1].values['empty-role'].value, '开发', 'choosing a new block source must not stay stuck on the remembered record');
});

test('capture batches frame reads, keeps second projects and awards, and separates their descriptions from generic essays', async () => {
  const fields = [{ id: 'c0-f0', label: '项目名称', section: '项目经历', blockKey: 'a', tag: 'input' }, { id: 'c0-f1', label: '项目描述', section: '项目经历', blockKey: 'a', tag: 'textarea' }, { id: 'c0-f2', label: '项目名称', section: '项目经历', blockKey: 'b', tag: 'input' }, { id: 'c0-f3', label: '项目描述', section: '项目经历', blockKey: 'b', tag: 'textarea' }, { id: 'c0-f4', label: '奖项名称', section: '获奖情况', blockKey: 'award', tag: 'input' }, { id: 'c0-f5', label: '等级', section: '获奖情况', blockKey: 'award', tag: 'custom-select' }];
  const values = ['甲项目', '甲描述', '乙项目', '乙描述', '虚构奖项', '一等奖'];
  let reads = 0, posted, acknowledgements = 0;
  const adapter = { url: () => 'https://fixture.example/apply', stillOnPage: () => true, frames: async () => [0], getDrafts: () => [], setDrafts() {}, run: async (_, fn, args) => {
    if (fn === core.hasUserEditedFields) return true;
    if (fn === core.scanPageFields) return fields;
    if (fn === core.readFieldValues) { reads++; return Object.fromEntries(args[0].map((id) => [id, { value: values[fields.findIndex((field) => field.id === id)], userEdited: true, editedAt: 1 }])); }
    if (fn === core.clearSavedUserEdits) acknowledgements++;
  }, api: async (_, init) => { posted = JSON.parse(init.body); return { ok: true, json: async () => ({ saved: 0, unchanged: 3, processed: 3 }) }; } };
  const result = await core.saveCorrectionsCore(adapter, undefined, true);
  assert.equal(reads, 1); assert.equal(posted.records.length, 3); assert.equal(posted.answers.length, 0); assert.equal(posted.records[1].content.name, '乙项目'); assert.equal(posted.records[2].content.level, '一等奖');
  assert.equal(result.unchanged, 3); assert.equal(acknowledgements, 1, 'deduplicated saves must acknowledge edits so automatic memory does not retry forever');
});

test('whole-module text is remembered across sites, kept as versions, and never becomes a structured name', async (t) => {
  const { db, remember: post, load } = await fixture(t);
  const text = '招聘看板：整理数据并完成仪表盘。校园服务：负责用户研究。';
  const capture = { category: 'project', content: { text } };
  await post([capture]); assert.equal((await post([capture])).data.saved, 0);
  await post([{ ...capture, content: { text: '用于另一个方向的项目原文' } }]);
  const row = await db.applicationMemory.findFirst(); assert.equal(row.content.text, text); assert.equal(row.alternatives.length, 1);
  const route = load('src/app/api/desktop-browser/profile/route.ts');
  const profile = (await route.GET({ url: 'http://localhost/profile' })).data;
  assert.equal(profile.projects.length, 0); assert.equal(profile.summaries.project, text);
  const field = { id: 'summary', tag: 'textarea', label: '项目经历', mappingKey: 'summary-key' };
  const { repeats, blocks } = core.classifyRepeatBlocks([field], profile);
  assert.equal(core.repeatFieldValue(field, repeats.get(field.id), profile), text);
  assert.equal(core.previewRecordBlocks(blocks, repeats, profile)[0].choices[0].values.summary.value, text);
  assert.equal(core.rowsForGroup(profile, 'project', true).length, 0);
  const name = { id: 'name', label: '项目名称', tag: 'input' };
  assert.equal(core.repeatFieldValue(name, core.classifyRepeatBlocks([name], profile).repeats.get('name'), profile), null);
  await db.user.update({ where: { id: 'fixture' }, data: { applicationProfile: { variants: [{ id: 'direction', name: '产品', projects: [] }] } } });
  const variant = (await route.GET({ url: 'http://localhost/profile?variantId=direction' })).data;
  assert.equal(variant.summaries.project, undefined); assert.ok(core.profileChoices(variant).some((choice) => choice.ref === 'summary:project'));
  const explicitlyMapped = { ...variant, mappings: [{ fieldKey: 'summary-key', ref: 'summary:project' }] };
  assert.equal(core.repeatFieldValue(field, core.classifyRepeatBlocks([field], explicitlyMapped).repeats.get(field.id), explicitlyMapped), text);
});

test('manual summary capture uses record memory rather than generic essay memory, including without headings', async () => {
  const fields = ['项目经历', '实习经历', '获奖情况', '教育背景'].map((label, index) => ({ id: `c0-f${index}`, tag: 'textarea', label }));
  let posted;
  const adapter = { url: () => 'https://fixture.example/apply', frames: async () => [0], getDrafts: () => [], setDrafts() {}, run: async (_, fn, args) => {
    if (fn === core.hasUserEditedFields) return true;
    if (fn === core.scanPageFields) return fields;
    if (fn === core.readFieldValues) return Object.fromEntries(args[0].map((id) => [id, { value: '我手写的整段经历', userEdited: true, editedAt: 1 }]));
  }, api: async (_, init) => { posted = JSON.parse(init.body); return { ok: true, json: async () => ({ processed: 4, recordsSaved: 4, saved: 4 }) }; } };
  await core.saveCorrectionsCore(adapter, undefined, true);
  assert.equal(posted.records.length, 4); assert.equal(posted.answers.length, 0);
  assert.ok(posted.records.every((record) => record.content.text === '我手写的整段经历'));
});

test('manual merge deduplicates versions and refuses to discard versions beyond the limit', async (t) => {
  const { db, remember: post, load } = await fixture(t);
  await post([{ category: 'project', content: { name: '项目甲', description: '主版本' } }, { category: 'project', content: { name: '项目乙', description: '另一个版本' } }]);
  const rows = await db.applicationMemory.findMany();
  await db.applicationMemory.update({ where: { id: rows[0].id }, data: { alternatives: Array.from({ length: 5 }, (_, i) => ({ content: { ...rows[0].content, description: `其他版本 ${i}` }, source: '手填' })) } });
  const actions = load('src/lib/actions/application-memory.ts');
  const rejected = await actions.mergeApplicationMemories(rows.map(({ id, revision }) => ({ id, revision })));
  assert.equal(rejected.ok, false); assert.equal(await db.applicationMemory.count(), 2);
  await db.applicationMemory.update({ where: { id: rows[0].id }, data: { alternatives: [{ content: rows[1].content, source: '其他页面' }] } });
  const merged = await actions.mergeApplicationMemories(rows.map(({ id, revision }) => ({ id, revision })));
  assert.equal(merged.ok, true); assert.equal(await db.applicationMemory.count(), 1); assert.equal(merged.data.alternatives.length, 1);
});

test('old clients cannot bypass review; latest edits replace a candidate and stale review is rejected', async (t) => {
  const { db, post, review } = await fixture(t);
  const answers = [{ fieldKey: 'why-1', questionLabel: '为什么申请？', answer: '第一版', kind: 'essay' }];
  assert.equal((await post([], { mode: 'commit', answers })).status, 400);
  assert.equal((await post([], { answers })).data.pending, 1, 'omitting mode must still stage');
  const first = await db.pendingApplicationChange.findFirst();
  await post([], { answers: [{ ...answers[0], answer: '最终版' }] });
  const latest = await db.pendingApplicationChange.findFirst();
  assert.equal(await db.pendingApplicationChange.count(), 1);
  assert.equal(latest.id, first.id); assert.equal(latest.revision, first.revision + 1);
  assert.equal(latest.payload.answer, '最终版');
  assert.equal((await review(first)).ok, false);
  assert.equal(await db.autofillAnswer.count(), 0);
  assert.equal((await review(latest, { answer: '核对时进一步改过的版本' })).ok, true);
  assert.equal((await db.autofillAnswer.findFirst()).answer, '核对时进一步改过的版本');
  assert.equal((await post([], { answers: [{ ...answers[0], answer: '最终版' }] })).data.pending, 0, 'the original capture must not reappear after review editing');
});

test('ignored content stays ignored on revisit, while material changes reopen and clearing withdraws stale candidates', async (t) => {
  const { db, post, actions, review } = await fixture(t);
  const answer = { fieldKey: 'why-1', questionLabel: '为什么申请？', answer: '先写的答案', kind: 'essay' };
  await post([], { answers: [answer] });
  let row = await db.pendingApplicationChange.findFirst();
  assert.equal((await actions.ignorePendingApplicationChange(row.id, row.revision)).ok, true);
  await post([], { answers: [answer] });
  assert.equal(await db.pendingApplicationChange.count({ where: { status: 'pending' } }), 0);
  await post([], { answers: [{ ...answer, answer: '修改后的答案' }] });
  row = await db.pendingApplicationChange.findFirst(); assert.equal(row.status, 'pending');
  const oldRevision = row.revision;
  await post([], { withdrawals: [{ kind: 'answer', fieldKey: 'why-1' }] });
  assert.equal((await db.pendingApplicationChange.findFirst()).status, 'withdrawn');
  assert.equal((await review(row)).ok, false);
  await post([], { answers: [{ ...answer, answer: '修改后的答案' }] });
  row = await db.pendingApplicationChange.findFirst(); assert.equal(row.status, 'pending'); assert.ok(row.revision > oldRevision);
  assert.equal(await db.autofillAnswer.count(), 0);
});

test('unchanged facts and equivalent date typography are not new discoveries', async (t) => {
  const { db, post } = await fixture(t);
  await db.user.update({ where: { id: 'fixture' }, data: { phone: '13800000000', birthDate: '2001-01', applicationProfile: { projects: [{ name: '已有项目', start: '2025-01', description: '既有成果' }] } } });
  const result = await post([{ category: 'project', content: { name: '已有项目', start: '2025.01', description: '既有成果' } }], { answers: [{ questionLabel: '手机', answer: '13800000000', kind: 'field' }, { questionLabel: '出生日期', answer: '2001年1月', kind: 'field' }] });
  assert.equal(result.status, 200); assert.equal(result.data.pending, 0);
  assert.equal(await db.pendingApplicationChange.count(), 0);
});

test('another version leaves the default byte-for-byte intact; partial replacement preserves unexposed fields; stale targets cannot overwrite', async (t) => {
  const { db, post, remember, review } = await fixture(t);
  const initial = { category: 'experience', content: { company: '测试公司', role: '实习生', start: '2025-01', end: '2025-03', description: '' } };
  await remember([initial]);
  let target = await db.applicationMemory.findFirst(); const original = JSON.stringify(target.content);
  await post([{ category: 'experience', captureKey: 'exp1', content: { company: '测试公司', role: '实习生', description: '新增成果' } }]);
  let row = await db.pendingApplicationChange.findFirst({ where: { status: 'pending' } });
  assert.equal((await review(row, { target: { id: target.id, revision: target.revision }, recordPreference: 'version' })).ok, true);
  target = await db.applicationMemory.findFirst();
  assert.equal(JSON.stringify(target.content), original, 'another version must not even fill empty default fields');
  assert.equal(target.alternatives[0].content.description, '新增成果'); assert.equal(target.alternatives[0].content.end, '2025-03');
  await post([{ category: 'experience', captureKey: 'exp1', content: { company: '测试公司', role: '实习生', description: '新默认成果' } }]);
  row = await db.pendingApplicationChange.findFirst({ where: { status: 'pending' } });
  const stale = target;
  await db.applicationMemory.update({ where: { id: target.id }, data: { revision: { increment: 1 } } });
  assert.equal((await review(row, { target: { id: stale.id, revision: stale.revision }, recordPreference: 'replace' })).ok, false);
  target = await db.applicationMemory.findFirst();
  assert.equal((await review(row, { target: { id: target.id, revision: target.revision }, recordPreference: 'replace' })).ok, true);
  target = await db.applicationMemory.findFirst();
  assert.equal(target.content.description, '新默认成果'); assert.equal(target.content.end, '2025-03');
  assert.ok(target.alternatives.some((item) => JSON.stringify(item.content) === original));
});

test('version limit never silently discards history and new records require a separate automatic-fill choice', async (t) => {
  const { db, post, remember, review, load } = await fixture(t);
  await remember([{ category: 'project', content: { name: '五版项目', description: '默认' } }]);
  let target = await db.applicationMemory.findFirst();
  const alternatives = Array.from({ length: 5 }, (_, index) => ({ content: { ...target.content, description: `历史 ${index}` }, source: '旧页' }));
  target = await db.applicationMemory.update({ where: { id: target.id }, data: { alternatives } });
  await post([{ category: 'project', captureKey: 'p1', content: { name: '五版项目', description: '第六版' } }]);
  const row = await db.pendingApplicationChange.findFirst({ where: { status: 'pending' } });
  assert.equal((await review(row, { target: { id: target.id, revision: target.revision } })).ok, false);
  assert.equal(JSON.stringify((await db.applicationMemory.findFirst()).alternatives), JSON.stringify(alternatives));
  assert.equal((await db.pendingApplicationChange.findUnique({ where: { id: row.id } })).status, 'pending');
  await post([{ category: 'project', captureKey: 'p2', content: { name: '手动选择项目', description: '核对内容' } }]);
  const fresh = await db.pendingApplicationChange.findFirst({ where: { status: 'pending', label: { contains: '手动选择项目' } } });
  assert.equal((await review(fresh)).ok, true);
  let profile = (await load('src/app/api/desktop-browser/profile/route.ts').GET({ url: 'http://localhost/profile' })).data;
  assert.equal(profile.projects.some((item) => item.name === '手动选择项目'), false);
  assert.ok(core.profileChoices(profile).some((item) => item.value === '手动选择项目'));
  const libraryRecord = profile.library.find((item) => item.content.name === '五版项目');
  assert.equal(libraryRecord.alternatives.length, 5);
  const refs = core.profileChoices(profile).filter((item) => item.value.startsWith('历史 '));
  assert.equal(new Set(refs.map((item) => item.ref)).size, 5, 'different descriptions need distinct stable selectable refs');
  await post([{ category: 'project', captureKey: 'p3', content: { name: '自动项目', description: '明确启用自动填写' } }]);
  assert.equal((await review(await db.pendingApplicationChange.findFirst({ where: { status: 'pending', label: { contains: '自动项目' } } }), { enableAutomatic: true })).ok, true);
  profile = (await load('src/app/api/desktop-browser/profile/route.ts').GET({ url: 'http://localhost/profile' })).data;
  assert.ok(profile.projects.some((item) => item.name === '自动项目'));
});

test('webpage drafts keep page/resume/variant contexts separate and preserve unapplied preview edits', async (t) => {
  const { db, load, post } = await fixture(t);
  const route = load('src/app/api/desktop-browser/application-draft/route.ts');
  const base = { contextKey: 'page:v2:https://company-one.example/apply', url: 'https://company-one.example/apply?token=private', fields: [{ label: '姓名', fieldKey: 'name', value: '预览名字', selected: true, edited: true }] };
  assert.equal((await route.POST({ json: async () => base })).status, 200);
  const fetchDraft = (draft) => route.GET({ url: `http://localhost/draft?${new URLSearchParams({ contextKey: draft.contextKey, url: draft.url, resumeVersionId: draft.resumeVersionId || '', variantId: draft.variantId || '' })}` });
  assert.equal((await post([], { draft: { ...base, fields: [{ label: '姓名', fieldKey: 'name', value: '', captured: true, edited: false }] } })).data.draftSaved, true);
  assert.equal((await fetchDraft(base)).data.content.fields[0].value, '预览名字');
  await post([], { draft: { ...base, fields: [{ label: '姓名', fieldKey: 'name', value: '网页手填名字', captured: true, edited: true }] } });
  await route.POST({ json: async () => ({ ...base, fields: [{ ...base.fields[0], value: '后来的预览' }] }) });
  assert.equal((await fetchDraft(base)).data.content.fields[0].value, '网页手填名字');
  await post([], { draft: { ...base, fields: [{ label: '姓名', fieldKey: 'name', value: '', captured: true, edited: false }] } });
  assert.equal((await fetchDraft(base)).data.content.fields[0].value, '网页手填名字', 'reloading an untouched blank form must not erase the last webpage draft');
  const variants = [{ ...base, url: 'https://company-one.example/apply?page=2' }, { ...base, variantId: 'product' }];
  for (const draft of variants) await route.POST({ json: async () => draft });
  await db.resumeVersion.create({ data: { id: 'resume1', userId: 'fixture', name: '测试简历' } });
  await route.POST({ json: async () => ({ ...base, resumeVersionId: 'resume1' }) });
  assert.equal(await db.applicationDraft.count(), 4);
  assert.equal((await fetchDraft({ ...base, variantId: 'other' })).data, null);
  await post([], { draft: { ...base, fields: [{ label: '姓名', fieldKey: 'name', value: '', captured: true, edited: true }] }, withdrawals: [{ kind: 'answer', fieldKey: 'name' }] });
  assert.equal((await fetchDraft(base)).data.content.fields[0].value, '', 'intentional clears must survive restore');
  assert.equal(await db.autofillAnswer.count(), 0); assert.equal(await db.applicationMemory.count(), 0);
});

test('capture scans an untouched page to install tracking and saves drafts even with discovery disabled', async () => {
  const fields = [{ id: 'c0-f0', mappingKey: 'essay', label: '为什么申请？', tag: 'textarea' }, { id: 'c0-f1', mappingKey: 'password', label: '密码', tag: 'input', type: 'password' }];
  let posted, reads = 0, signature;
  const adapter = { url: () => 'https://fixture.example/apply', stillOnPage: () => true, frames: async () => [0], getDrafts: () => [], getDraftSignature: () => signature, setDraftSignature: (value) => { signature = value; }, run: async (_, fn, args) => {
    if (fn === core.hasUserEditedFields) throw new Error('must not exit before installing trackers');
    if (fn === core.scanPageFields) return fields;
    if (fn === core.readFieldValues) { reads++; return Object.fromEntries(args[0].map((id) => [id, { value: '只保留本次的手填内容', userEdited: true, editedAt: 1 }])); }
  }, api: async (_, init) => { posted = JSON.parse(init.body); return { ok: true, json: async () => ({ draftSaved: true, processed: 0, pendingTotal: 0 }) }; } };
  const result = await core.saveCorrectionsCore(adapter, undefined, true, 'product', false);
  assert.equal(reads, 1); assert.equal(result.draftSaved, true);
  assert.equal(posted.draft.fields.length, 1); assert.equal(posted.draft.variantId, 'product');
  assert.equal(posted.draft.fields[0].value, '只保留本次的手填内容');
  assert.equal(posted.answers.length, 0); assert.equal(posted.records.length, 0);
  posted = undefined;
  await core.saveCorrectionsCore(adapter, undefined, true, 'product', false);
  assert.equal(posted, undefined, 'unchanged draft must not be written on every poll');
});

test('whole-module alternative versions stay individually selectable without enabling automatic reuse', () => {
  const profile = { projects: [], library: [{ id: 'summary1', category: 'project', enabled: false, content: { text: '默认原文' }, alternatives: [{ content: { text: '其他方向原文' }, source: '页面' }] }] };
  const field = { id: 'summary', mappingKey: 'summary-field', label: '项目经历', tag: 'textarea' };
  const { repeats, blocks } = core.classifyRepeatBlocks([field], profile);
  assert.equal(core.repeatFieldValue(field, repeats.get(field.id), profile), null);
  const choices = core.previewRecordBlocks(blocks, repeats, profile)[0].choices;
  const alternative = choices.find((choice) => choice.values.summary.value === '其他方向原文');
  assert.ok(alternative);
  const mapped = { ...profile, mappings: [{ fieldKey: field.mappingKey, ref: alternative.ref }] };
  assert.equal(core.repeatFieldValue(field, core.classifyRepeatBlocks([field], mapped).repeats.get(field.id), mapped), '其他方向原文');
});
