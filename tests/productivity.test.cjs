const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");
function load(file, mocks = {}, globals = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks, globals) : require(id)), console, Date, Error, Buffer, URL, process, AbortSignal, setTimeout, clearTimeout, ...globals });
  return mod.exports;
}
test("Gregorian grid: leap years, weekday alignment and cross-year navigation", () => {
  const { monthGrid, localDay } = load("src/lib/calendar-grid.ts");
  assert.equal(monthGrid(2024, 1).filter((d) => d.getMonth() === 1).length, 29);
  assert.equal(monthGrid(2100, 1).filter((d) => d.getMonth() === 1).length, 28);
  assert.equal(monthGrid(2026, 0)[0].getDay(), 1);
  assert.equal(localDay(monthGrid(2026, 0)[3]), "2026-01-01");
});
test("termination preserves ended stage, never reuses terminal outcome as a stage", () => {
  const { terminationFields } = load("src/lib/termination.ts");
  for (const stage of ["REJECTED", "WITHDRAWN", "CANCELLED"]) assert.equal(terminationFields(stage, "OA", "技术笔试").terminatedAtStage, "OA");
  assert.equal(terminationFields("WITHDRAWN", "REJECTED").terminatedAtStage, null);
  assert.equal(terminationFields("OA", "APPLIED").terminatedAtStage, null);
  const { computeOutcomes } = load("src/lib/funnel.ts");
  assert.equal(computeOutcomes(["REJECTED", "WITHDRAWN", "CANCELLED"].map((currentStage) => ({ currentStage }))).rejected, 1);
});
test("additive migrations preserve old data; notes conflict safely; event moves reschedule one reminder; delivery is persisted", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/productivity-tests"); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-")); const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  const migrations = fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((s) => /^\d/.test(s)).sort();
  for (const name of migrations.filter((s) => s < "20260927")) sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", name, "migration.sql"), "utf8"));
  sql.exec(`INSERT INTO User(id,email) VALUES ('local-user','fixture@local'); INSERT INTO Company(id,name) VALUES ('company','Keep company'); INSERT INTO Position(id,userId,companyId,title) VALUES ('position','local-user','company','Keep JD');`);
  for (const name of migrations.filter((s) => s >= "20260927")) sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", name, "migration.sql"), "utf8"));
  assert.equal(sql.prepare("SELECT title FROM Position WHERE id='position'").get().title, "Keep JD");
  assert.equal(sql.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  t.after(async () => { await db.$disconnect(); if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup"); fs.rmSync(root, { recursive: true }); });
  const mocks = { "@/lib/db": { db }, "@/lib/session": { LOCAL_USER_ID: "local-user", requireUser: async () => ({ id: "local-user" }) }, "next/cache": { revalidatePath() {} }, "@/lib/action-result": load("src/lib/action-result.ts"), "@/lib/note-colors": load("src/lib/note-colors.ts") };
  const actions = load("src/lib/actions/productivity.ts", mocks);
  const note = (await actions.createNote()).data;
  assert.equal(note.color, "cream");
  assert.equal((await actions.saveNote({ ...note, content: "跨月仍在", color: "sage" })).ok, true);
  assert.equal((await actions.saveNote({ ...note, content: "stale overwrites" })).ok, false);
  assert.equal((await actions.listNotes())[0].content, "跨月仍在");
  assert.equal((await actions.listNotes())[0].color, "sage");
  const start = new Date(Date.now() - 3600000);
  const input = { title: "笔试", description: "test", startsAt: start, endsAt: null, allDay: false, dateKey: "2026-09-27", timeZone: "Asia/Shanghai", noteId: note.id, offsetMinutes: 30 };
  const created = await actions.saveEvent(input); assert.equal(created.ok, true);
  const event = created.data;
  const scheduler = load("src/lib/event-reminders.ts", mocks);
  const claim = await scheduler.claimEventReminders("local-user"); assert.equal(claim.reminders.length, 1);
  assert.equal((await scheduler.claimEventReminders("local-user")).reminders.length, 0);
  await scheduler.acknowledgeEventReminders("local-user", [claim.reminders[0].id], claim.claimToken);
  assert.equal((await scheduler.claimEventReminders("local-user")).reminders.length, 0);
  const moved = await actions.saveEvent({ ...input, id: event.id, revision: 0, startsAt: new Date(start.getTime() + 86400000) }); assert.equal(moved.ok, true);
  const reminders = await db.eventReminder.findMany(); assert.equal(reminders.length, 1); assert.equal(reminders[0].deliveredAt, null); assert.equal(reminders[0].scheduledAt.getTime(), start.getTime() + 86400000 - 1800000);
  const backupEnv = { process: { ...process, env: { ...process.env, LOCAL_UPLOADS_DIR: path.join(root, "uploads") } } };
  const backupCore = load("src/lib/backup-core.ts", mocks, backupEnv);
  const backup = load("src/lib/actions/backup.ts", { ...mocks, os: { homedir: () => root }, "@/lib/local-storage": {}, "@/lib/backup-core": backupCore }, backupEnv);
  const exported = await backup.exportBackup(); assert.equal(exported.ok, true);
  const backupJson = fs.readFileSync(exported.data.path, "utf8");
  assert.equal(JSON.parse(backupJson).data.calendarEvent.length, 1);
  await db.desktopNote.update({ where: { id: note.id }, data: { content: "Changed after export" } });
  const restored = await backup.importBackup(backupJson); assert.equal(restored.ok, true);
  assert.equal((await actions.listNotes())[0].content, "跨月仍在");
  assert.equal((await actions.listNotes())[0].color, "sage");
  assert.equal(await db.eventReminder.count(), 1);

  const validation = load("src/lib/validation.ts");
  const appActions = load("src/lib/actions/applications.ts", { ...mocks, "@/lib/validation": validation, "@/lib/company-resolver": { resolveCompanyId: async () => "company" }, "@/lib/application-stage-history": load("src/lib/application-stage-history.ts"), "@/lib/termination": load("src/lib/termination.ts") });
  await db.application.create({ data: { id: "application", userId: "local-user", companyId: "company", title: "Keep application", currentStage: "OA", currentStageDate: start, appliedDate: start, stageHistory: { create: { stage: "OA", enteredAt: start } } } });
  const end = await appActions.addStageUpdate("application", { stage: "WITHDRAWN" });
  assert.equal((await db.stageHistory.findUnique({ where: { id: end.stageHistoryId } })).terminatedAtStage, "OA");
  assert.equal((await db.application.findUnique({ where: { id: "application" } })).currentStage, "WITHDRAWN");
  const remove = await appActions.deleteStageHistory(end.stageHistoryId);
  assert.equal(remove.ok, true);
  assert.equal((await db.application.findUnique({ where: { id: "application" } })).currentStage, "OA");

  const jobs = load("src/lib/actions/positions.ts", { ...mocks, "@/lib/validation": validation, "@/lib/company-resolver": { resolveCompanyId: async () => "company" }, "@/lib/scoring": load("src/lib/scoring.ts") });
  const captureKey = require("crypto").randomUUID();
  const positionInput = { companyName: "Keep company", title: "Graduate engineer", jdText: "Original JD", jdUrl: "https://jobs.example.com/job?id=42&utm_source=share", recruitmentType: "校招" };
  const first = await jobs.createPosition(positionInput, captureKey);
  assert.equal(await jobs.createPosition(positionInput, captureKey), first);
  assert.equal(await db.position.count({ where: { captureKey } }), 1);
  const capture = load("src/lib/actions/job-capture.ts", { ...mocks, "@/lib/job-capture": load("src/lib/job-capture.ts"), "@/lib/ai-providers": {} });
  assert.equal((await capture.findDuplicatePositions({ companyName: "different", title: "different", jdUrl: "https://jobs.example.com/job?id=42" })).length, 1);
  assert.equal((await capture.findDuplicatePositions({ companyName: "keep COMPANY", title: "Graduate Engineer", jdUrl: "https://different.example/job" })).length, 1);
  await actions.deleteNote(note.id); assert.equal((await actions.listEvents())[0].noteId, null);
  assert.equal((await actions.deleteEvent(event.id, 0)).ok, false);
  await actions.deleteEvent(event.id, 1); assert.equal(await db.eventReminder.count(), 0);
  // Older exports have no productivity tables, and remain importable.
  const old = JSON.parse(backupJson); delete old.data.desktopNote; delete old.data.calendarEvent; delete old.data.eventReminder;
  assert.equal((await backup.importBackup(JSON.stringify(old))).ok, true);
  assert.equal(await db.position.count(), 1);
});

test("capture canonicalization preserves job IDs and rejects local network destinations", () => {
  const { normalizeJobUrl, isPublicAddress } = load("src/lib/job-capture.ts");
  assert.equal(normalizeJobUrl("https://example.com/jobs?id=2&utm_source=x"), "https://example.com/jobs?id=2");
  assert.notEqual(normalizeJobUrl("https://example.com/#/job/1"), normalizeJobUrl("https://example.com/#/job/2"));
  assert.equal(normalizeJobUrl("javascript:alert(1)"), null);
  for (const ip of ["127.0.0.1", "10.0.0.2", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1"]) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("desktop windows restore off-screen bounds safely; clipboard is read only by capture; IPC rejects other windows", (t) => {
  const { EventEmitter } = require("events");
  const base = path.resolve(__dirname, "../.local-run/window-tests"); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  t.after(() => { if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup"); fs.rmSync(root, { recursive: true }); });
  const handlers = new Map(), windows = []; let reads = 0, notesAtLogin = false, mainOpens = 0;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.bounds = options; this.pinned = !!options.alwaysOnTop; this.webContents = new EventEmitter(); this.webContents.id = windows.length + 10; this.webContents.mainFrame = { url: "" }; this.webContents.setWindowOpenHandler = () => {}; windows.push(this); }
    loadURL(url) { this.webContents.mainFrame.url = url; }
    getBounds() { return this.bounds; }
    setAlwaysOnTop(pinned) { this.pinned = pinned; }
    setBackgroundColor(color) { this.color = color; }
    isAlwaysOnTop() { return this.pinned; }
    isDestroyed() { return false; }
    show() {} focus() {} reload() {}
  }
  const displays = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }];
  const electron = { app: { getPath: () => root }, BrowserWindow: Window, ipcMain: { handle: (k, v) => handlers.set(k, v) }, screen: { getAllDisplays: () => displays }, clipboard: { readText: () => { reads++; return "user provided JD"; } }, globalShortcut: { register: () => true, unregister() {} }, Notification: { isSupported: () => false }, powerMonitor: new EventEmitter(), dialog: { showMessageBoxSync: () => 0 } };
  const module = load("electron/productivity.js", { electron }, { __dirname: path.resolve(__dirname, "../electron"), setInterval: () => 1, clearInterval() {} });
  const bounds = module.fitBounds({ x: 10000, y: -1000, width: 7000, height: 4000 }, displays);
  assert.equal(bounds.x, 0); assert.equal(bounds.y, 0); assert.equal(bounds.width, 1440); assert.equal(bounds.height, 900);
  const manager = module.setupProductivity({ port: 3210, token: "fixture", getMainWindow: () => null, showMainWindow() { mainOpens++; }, getNotesAtLogin: () => notesAtLogin, setNotesAtLogin: (value) => (notesAtLogin = value) });
  manager.open("notes"); assert.equal(reads, 0);
  const win = windows[0], event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.equal(win.options.fullscreenable, false); assert.equal(win.options.maximizable, false);
  handlers.get("productivity:note")(event, "saved-note"); handlers.get("productivity:pin")(event, true);
  handlers.get("productivity:color")(event, "#e6ece4"); assert.equal(win.color, "#e6ece4");
  handlers.get("productivity:main")(event); assert.equal(mainOpens, 1);
  assert.equal(handlers.get("productivity:notes-at-login")(event, true), true);
  assert.equal(handlers.get("productivity:state")(event).pinned, true);
  assert.equal(handlers.get("productivity:state")(event).notesAtLogin, true);
  assert.throws(() => handlers.get("productivity:open")({ sender: { id: 999 }, senderFrame: {} }, "capture"));
  manager.open("capture"); assert.equal(reads, 1);
  const capture = windows[1], captureEvent = { sender: capture.webContents, senderFrame: capture.webContents.mainFrame };
  assert.equal(handlers.get("productivity:state")(captureEvent).clipboard, "user provided JD");
  assert.equal(handlers.get("productivity:state")(captureEvent).clipboard, ""); assert.equal(reads, 1);
  manager.shutdown();
  const saved = JSON.parse(fs.readFileSync(path.join(root, "desktop-windows.json"), "utf8")); assert.equal(saved.windows[0].noteId, "saved-note"); assert.equal(saved.windows[0].pinned, true); assert.equal(saved.windows[0].visible, true);
  const restarted = module.setupProductivity({ port: 3210, token: "fixture", getMainWindow: () => null, showMainWindow() {} });
  assert.equal(windows[2].isAlwaysOnTop(), true); assert.match(windows[2].webContents.mainFrame.url, /id=saved-note/); assert.equal(reads, 1); restarted.shutdown();
  const closed = JSON.parse(fs.readFileSync(path.join(root, "desktop-windows.json"), "utf8"));
  closed.windows.forEach((state) => { state.visible = false; state.bounds = { x: 0, y: 0, width: 1440, height: 900 }; });
  fs.writeFileSync(path.join(root, "desktop-windows.json"), JSON.stringify(closed));
  const count = windows.length;
  const login = module.setupProductivity({ port: 3210, token: "fixture", getMainWindow: () => null, showMainWindow() {}, openNotesAtLogin: true });
  assert.equal(windows.length, count + 1); assert.match(windows.at(-1).webContents.mainFrame.url, /\/desktop\/notes/);
  assert.equal(windows.at(-1).options.width, 720); assert.equal(windows.at(-1).options.height, 820); login.shutdown();
});
