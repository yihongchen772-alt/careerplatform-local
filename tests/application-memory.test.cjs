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
  return { db, load, post };
}

test('capture is idempotent, cross-site sources are compact, and date typography does not create another project/version', async (t) => {
  const { db, post, load } = await fixture(t);
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
  const { db, post, load } = await fixture(t);
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
  const { db, post } = await fixture(t);
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
  const { db, post, load } = await fixture(t);
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
  const { db, post, load } = await fixture(t);
  const answers = [{ questionLabel: '姓名', answer: '虚构姓名', kind: 'field' }];
  assert.equal((await post([], { answers })).data.answersSaved, 1);
  assert.equal((await post([], { answers })).data.saved, 0);
  await post([], { answers: [{ questionLabel: '是否接受调剂？', answer: '接受', kind: 'short' }, { questionLabel: '是否不接受调剂？', answer: '不接受', kind: 'short' }] });
  await post([], { contextKey: 'page:v2:https://company-two.example/apply', answers: [{ questionLabel: '姓名', answer: '其他名字', kind: 'field' }] });
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
  assert.equal((await actions.acceptPendingApplicationChange(pendingAnswer.id, { shareAcrossCompanies: false })).ok, true);
  const savedAnswer = await db.autofillAnswer.findFirst();
  assert.equal(savedAnswer.contextKey, 'page:v2:https://company-one.example/apply');
  assert.equal(savedAnswer.confirmed, true);
  assert.equal((await actions.acceptPendingApplicationChange(pendingRecord.id, { shareAcrossCompanies: false })).ok, true);
  assert.equal(await db.applicationMemory.count(), 1);
  assert.equal(await db.pendingApplicationChange.count(), 0);

  await post([{ ...record, content: { ...record.content, description: '准备设为默认的新描述' } }], { mode: 'stage' });
  const replacement = await db.pendingApplicationChange.findFirst();
  assert.equal((await actions.acceptPendingApplicationChange(replacement.id, { shareAcrossCompanies: false, recordPreference: 'replace' })).ok, true);
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
  const { db, post, load } = await fixture(t);
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
  const { db, post, load } = await fixture(t);
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
