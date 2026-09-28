const { app, BrowserWindow, ipcMain, screen, clipboard, globalShortcut, Notification, powerMonitor, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

function fitBounds(bounds, displays) {
  const fallback = displays[0].workArea;
  const candidate = displays.find(({ workArea: a }) => bounds && bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y)?.workArea || fallback;
  const width = Math.min(Math.max(Number(bounds?.width) || 430, 320), candidate.width);
  const height = Math.min(Math.max(Number(bounds?.height) || 520, 300), candidate.height);
  return { width, height, x: Math.max(candidate.x, Math.min(Number.isFinite(bounds?.x) ? bounds.x : candidate.x, candidate.x + candidate.width - width)), y: Math.max(candidate.y, Math.min(Number.isFinite(bounds?.y) ? bounds.y : candidate.y, candidate.y + candidate.height - height)) };
}

function setupProductivity({ port, token, getMainWindow, showMainWindow, getNotesAtLogin = () => false, setNotesAtLogin = () => false, openNotesAtLogin = false }) {
  const origin = `http://localhost:${port}`;
  const file = path.join(app.getPath("userData"), "desktop-windows.json");
  let states = [], mainVisible = true;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    states = (Array.isArray(saved) ? saved : saved.windows || []).filter((s) => ["notes", "calendar"].includes(s.kind)).slice(0, 30);
    if (typeof saved.mainVisible === "boolean") mainVisible = saved.mainVisible;
  } catch { /* first launch */ }
  const windows = new Map(); let quitting = false, polling = false;
  function persist() { try { fs.writeFileSync(file + ".tmp", JSON.stringify({ mainVisible, windows: states })); fs.renameSync(file + ".tmp", file); } catch (error) { console.error("Window state save failed", error.message); } }
  function setMainWindow(main) {
    main.on("show", () => { mainVisible = true; persist(); });
    main.on("hide", () => { mainVisible = false; persist(); });
    main.on("close", () => { if (!quitting) { mainVisible = false; persist(); } });
  }
  if (getMainWindow()) setMainWindow(getMainWindow());
  function open(kind, id, capture = false, restore, newWindow = false) {
    if (!["notes", "calendar", "capture"].includes(kind)) return;
    const existing = [...windows.values()].find((s) => s.kind === kind && (kind !== "notes" || (id ? s.noteId === id : true)));
    if (existing && !restore && !newWindow) { if (capture && dialog.showMessageBoxSync(existing.win, { type: "question", message: "用新的剪贴板内容替换当前捕获草稿？", buttons: ["保留当前草稿", "替换"], defaultId: 0, cancelId: 0 }) === 1) { existing.clipboard = clipboard.readText().slice(0, 50000); existing.win.reload(); } existing.win.show(); existing.win.focus(); return; }
    const previous = !newWindow && states.find((s) => !s.visible && s.kind === kind && (!id || s.noteId === id));
    const state = restore || previous || { key: require("crypto").randomUUID(), kind, noteId: id || null, visible: true, pinned: false };
    if (!restore && !previous && kind !== "capture") { states = states.filter((s) => s.visible).concat(states.filter((s) => !s.visible).slice(-20)); states.push(state); }
    // Older note windows may have saved screen-sized bounds while fullscreen.
    const bounds = kind === "notes" && state.bounds ? { ...state.bounds, width: Math.min(state.bounds.width, 720), height: Math.min(state.bounds.height, 820) } : state.bounds;
    const win = new BrowserWindow({ show: process.env.CAREERPLATFORM_TEST_MODE !== "1", ...fitBounds(bounds, screen.getAllDisplays()), minWidth: 320, minHeight: 300, title: kind === "notes" ? "求职罗盘 · 便利贴" : kind === "calendar" ? "求职罗盘 · 日历" : "求职罗盘 · 岗位捕获", alwaysOnTop: !!state.pinned, ...(kind === "notes" ? { backgroundColor: "#f5f0e7", fullscreenable: false, maximizable: false, ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}) } : {}), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "productivity-preload.js") } });
    if (kind === "notes") win.on("enter-full-screen", () => win.setFullScreen(false));
    const entry = { ...state, win, state, clipboard: capture ? clipboard.readText().slice(0, 50000) : "" }; windows.set(win.webContents.id, entry);
    const allowed = (url) => { try { const u = new URL(url); return u.origin === origin && u.pathname.startsWith("/desktop/"); } catch { return false; } };
    win.webContents.on("will-navigate", (e, url) => { if (!allowed(url)) e.preventDefault(); });
    win.webContents.on("will-redirect", (e, url) => { if (!allowed(url)) e.preventDefault(); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    let timer;
    function remember() { clearTimeout(timer); timer = setTimeout(() => { if (!win.isDestroyed()) { state.bounds = win.getBounds(); state.pinned = win.isAlwaysOnTop(); persist(); } }, 250); }
    win.on("query-session-end", () => { quitting = true; state.bounds = win.getBounds(); persist(); });
    win.on("move", remember); win.on("resize", remember);
    win.on("close", () => { state.bounds = win.getBounds(); state.pinned = win.isAlwaysOnTop(); });
    // Capture the ID before WebContents is destroyed.
    const contentsId = win.webContents.id;
    win.on("closed", () => { clearTimeout(timer); windows.delete(contentsId); if (!quitting) state.visible = false; persist(); });
    state.visible = true; persist();
    win.loadURL(`${origin}/desktop/${kind}?window=${encodeURIComponent(state.key)}${state.noteId ? `&id=${encodeURIComponent(state.noteId)}` : ""}`);
  }
  function source(event) {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted frame");
    const u = new URL(event.senderFrame.url);
    if (u.origin !== origin || (!windows.has(event.sender.id) && event.sender !== getMainWindow()?.webContents)) throw new Error("Untrusted window");
    return windows.get(event.sender.id);
  }
  ipcMain.handle("productivity:open", (e, kind, id, newWindow) => { source(e); if (id != null && (typeof id !== "string" || id.length > 100)) return; open(kind, id, kind === "capture", undefined, newWindow === true); });
  ipcMain.handle("productivity:position", (e, id) => { source(e); if (typeof id !== "string" || id.length > 100) return; showMainWindow(); getMainWindow()?.loadURL(`${origin}/pool?position=${encodeURIComponent(id)}`); });
  ipcMain.handle("productivity:pin", (e, value) => { const s = source(e); if (!s) return false; s.win.setAlwaysOnTop(value === true); s.state.pinned = value === true; persist(); return s.win.isAlwaysOnTop(); });
  ipcMain.handle("productivity:state", (e) => { const s = source(e); const value = { pinned: !!s?.win.isAlwaysOnTop(), clipboard: s?.clipboard || "", notesAtLogin: !!getNotesAtLogin(), platform: process.platform }; if (s) s.clipboard = ""; return value; });
  ipcMain.handle("productivity:note", (e, id) => { const s = source(e); if (s?.kind === "notes" && typeof id === "string" && id.length < 100) { s.noteId = id; s.state.noteId = id; persist(); } });
  ipcMain.handle("productivity:color", (e, value) => { const s = source(e); if (s?.kind === "notes" && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) s.win.setBackgroundColor(value); });
  ipcMain.handle("productivity:main", (e) => { source(e); showMainWindow(); });
  ipcMain.handle("productivity:notes-at-login", (e, value) => { const s = source(e); if (s?.kind !== "notes" || typeof value !== "boolean") return !!getNotesAtLogin(); return !!setNotesAtLogin(value); });
  for (const state of [...states]) if (state.visible) open(state.kind, state.noteId, false, state);
  if (openNotesAtLogin && ![...windows.values()].some((s) => s.kind === "notes")) open("notes");
  const shortcut = "CommandOrControl+Shift+J";
  if (!globalShortcut.register(shortcut, () => open("capture", null, true))) console.warn("Job Capture shortcut unavailable; use tray menu instead");

  async function request(body) {
    const response = await fetch(`${origin}/api/desktop-reminders`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Reminder HTTP ${response.status}`);
    return response.json();
  }
  const notifications = new Set();
  async function poll() {
    if (polling || quitting || !Notification.isSupported()) return;
    polling = true;
    try {
      const { reminders, claimToken } = await request({ action: "claim" });
      const missed = reminders.filter((r) => Date.now() - new Date(r.scheduledAt).getTime() > 60000);
      const upcoming = reminders.filter((r) => !missed.includes(r));
      const groups = [...upcoming.map((r) => [r]), ...(missed.length ? [missed] : [])];
      for (const group of groups) {
        const notification = new Notification({ title: group === missed ? `你有 ${group.length} 条已过期提醒` : "求职罗盘 · 日程提醒", body: group.slice(0, 4).map((r) => `${r.title}\n原定提醒：${new Date(r.scheduledAt).toLocaleString()}`).join("\n") });
        notifications.add(notification);
        notification.on("click", () => open("calendar"));
        notification.on("close", () => notifications.delete(notification));
        notification.once("show", () => { void request({ action: "ack", ids: group.map((r) => r.id), claimToken }).catch(console.error); });
        notification.once("failed", () => { notifications.delete(notification); });
        notification.show();
      }
    } catch (error) { console.error("Event reminders:", error.message); }
    finally { polling = false; }
  }
  const interval = setInterval(poll, 15000);
  powerMonitor.on("resume", poll); void poll();
  return { open: (kind) => open(kind, null, kind === "capture"), setMainWindow, shutdown() { quitting = true; persist(); clearInterval(interval); powerMonitor.removeListener("resume", poll); globalShortcut.unregister(shortcut); } };
}
module.exports = { setupProductivity, fitBounds };
