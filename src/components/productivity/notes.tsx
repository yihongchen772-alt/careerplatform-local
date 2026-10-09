"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Ellipsis, ExternalLink, Plus, StickyNote } from "lucide-react";
import { createNote, deleteNote, listNotes, saveNote } from "@/lib/actions/productivity";
import { NOTE_COLORS, NOTE_PALETTE, type NoteColor } from "@/lib/note-colors";
import { toast } from "sonner";

type Note = Awaited<ReturnType<typeof listNotes>>[number];
function draftKey(id: string) { return `jobcompass:note-draft:${id}:${new URLSearchParams(location.search).get("window") || "browser"}`; }
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const current = useRef<Note | null>(null);
  const dirty = useRef(false), saving = useRef(false), blocked = useRef(false);
  const [changing, setChanging] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState("正在加载"), [layer, setLayer] = useState<DesktopWindowLayer>("normal");
  const [menuOpen, setMenuOpen] = useState(false);
  const [onLogin, setOnLogin] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [desktop, setDesktop] = useState(false);

  const flush = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot || !dirty.current || saving.current || blocked.current) return false;
    saving.current = true;
    try {
      const result = await saveNote(snapshot);
      if (!result.ok) { blocked.current = true; setConflict(true); setStatus(result.message); return false; }
      if (current.current?.id === snapshot.id) {
        const unchanged = current.current.content === snapshot.content && current.current.template === snapshot.template && current.current.color === snapshot.color;
        current.current = { ...current.current, revision: result.data.revision };
        const savedNote = current.current;
        setNote(savedNote); dirty.current = !unchanged;
        setNotes((rows) => rows.map((row) => row.id === snapshot.id ? savedNote : row));
        if (unchanged) localStorage.removeItem(draftKey(snapshot.id));
        else localStorage.setItem(draftKey(snapshot.id), JSON.stringify({ content: current.current.content, template: current.current.template, color: current.current.color, revision: result.data.revision }));
        setStatus(unchanged ? "已保存" : "正在保存…");
      }
      return true;
    } catch { setStatus("保存失败，草稿保存在本机；将自动重试"); return false; }
    finally { saving.current = false; }
  }, []);

  function select(row: Note) {
    let restored = row; blocked.current = false; setConflict(false); setMenuOpen(false);
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(row.id)) || "null");
      if (draft && typeof draft.content === "string") {
        restored = { ...row, content: draft.content, template: draft.template === "lined" ? "lined" : "blank", color: NOTE_COLORS.includes(draft.color) ? draft.color : row.color };
        dirty.current = true;
        blocked.current = draft.revision !== row.revision && (draft.content !== row.content || draft.template !== row.template || draft.color !== row.color);
        setConflict(blocked.current);
      } else dirty.current = false;
    } catch { dirty.current = false; }
    current.current = restored; setNote(restored);
    setStatus(blocked.current ? "草稿与另一窗口的修改冲突，请复制正文后重新加载。" : dirty.current ? "已恢复未保存草稿" : "已保存");
    void window.desktopProductivity?.selectNote(row.id);
  }

  useEffect(() => {
    let alive = true;
    void listNotes().then((rows) => { if (!alive) return; setNotes(rows); const id = new URLSearchParams(location.search).get("id"); const row = rows.find((n) => n.id === id) || rows[0]; if (row) select(row); else setStatus("点击新建，开始写便签"); }).catch(() => setStatus("无法加载，请重新打开窗口")).finally(() => { if (alive) setChanging(false); });
    void window.desktopProductivity?.state().then((s) => { if (!alive) return; setDesktop(true); setLayer(s.layer ?? (s.pinned ? "top" : "normal")); setOnLogin(s.notesAtLogin); setIsMac(s.platform === "darwin"); });
    const timer = setInterval(() => { void flush(); }, 650);
    const unload = () => { if (dirty.current) void flush(); };
    window.addEventListener("beforeunload", unload);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("beforeunload", unload); void flush(); };
  }, [flush]);

  const colorName = note && NOTE_COLORS.includes(note.color as NoteColor) ? note.color as NoteColor : "cream";
  const palette = NOTE_PALETTE[colorName];
  useEffect(() => { void window.desktopProductivity?.setColor(palette.background); }, [palette.background]);

  async function switchNote(id: string) {
    if (changing) return;
    setChanging(true);
    try {
      if (dirty.current && !await flush()) return;
      if (dirty.current) return;
      const rows = await listNotes(); setNotes(rows); const row = rows.find((n) => n.id === id); if (row) select(row);
    } catch { toast.error("切换失败，请重试"); } finally { setChanging(false); }
  }
  async function add() {
    if (changing) return;
    setChanging(true);
    try {
      if ((dirty.current && !await flush()) || dirty.current) return;
      const r = await createNote();
      if (r.ok) { setNotes((ns) => [...ns, r.data]); select(r.data); } else toast.error(r.message);
    } catch { toast.error("新建失败，请重试"); } finally { setChanging(false); }
  }
  function edit(change: Partial<Note>) {
    if (!current.current) return;
    const next = { ...current.current, ...change }; current.current = next; setNote(next); dirty.current = true; setStatus("正在保存…");
    try { localStorage.setItem(draftKey(next.id), JSON.stringify({ content: next.content, template: next.template, color: next.color, revision: next.revision })); } catch { setStatus("正在保存（本机草稿缓存不可用）"); }
  }
  async function remove() {
    if (!note || !confirm("删除这张便签？关联日程会保留。") || saving.current) return;
    const r = await deleteNote(note.id);
    if (!r.ok) return toast.error(r.message);
    localStorage.removeItem(draftKey(note.id)); dirty.current = false; current.current = null; setNote(null); setMenuOpen(false);
    const rows = await listNotes(); setNotes(rows); if (rows[0]) select(rows[0]);
  }
  async function toggleLogin() {
    if (!window.desktopProductivity) return;
    try { setOnLogin(await window.desktopProductivity.setNotesAtLogin(!onLogin)); }
    catch { toast.error("开机启动设置失败，请在系统设置中检查登录项"); }
  }
  async function chooseLayer(next: DesktopWindowLayer) {
    if (!window.desktopProductivity) return;
    try { setLayer(await window.desktopProductivity.setLayer(next)); }
    catch { toast.error("窗口位置没能切换，请重试"); }
  }
  function openMain() {
    if (window.desktopProductivity) void window.desktopProductivity.openMain();
    else window.open("/dashboard", "_blank", "noopener");
  }

  return <main className="relative flex h-screen min-h-[300px] flex-col overflow-hidden" style={{ backgroundColor: palette.background, color: palette.ink }}>
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: palette.border, paddingLeft: isMac ? 82 : 12, WebkitAppRegion: "drag" } as CSSProperties}>
      <StickyNote className="size-4 shrink-0 opacity-65" aria-hidden="true" />
      <strong className="hidden shrink-0 text-sm font-semibold sm:inline">便利贴</strong>
      <select aria-label="切换便签" disabled={changing} className="min-w-0 flex-1 rounded-lg border bg-white/45 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-current/25" style={{ ...noDrag, borderColor: palette.border }} value={note?.id || ""} onChange={(e) => void switchNote(e.target.value)}>
        <option value="" disabled>选择便签</option>
        {notes.map((n, index) => <option key={n.id} value={n.id}>{(n.id === note?.id ? note.content : n.content).split("\n")[0].slice(0, 20) || `便签 ${index + 1}`}</option>)}
      </select>
      <button type="button" aria-label="新建" title="新建便签" disabled={changing} onClick={add} className="rounded-lg p-1.5 hover:bg-black/5 disabled:opacity-50" style={noDrag}><Plus className="size-4" /></button>
      <button type="button" aria-label="打开求职罗盘" title="打开求职罗盘" onClick={openMain} className="rounded-lg p-1.5 hover:bg-black/5" style={noDrag}><ExternalLink className="size-4" /></button>
      <button type="button" aria-label="便签菜单" title="便签菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} className="rounded-lg p-1.5 hover:bg-black/5" style={noDrag}><Ellipsis className="size-4" /></button>
    </header>

    {menuOpen && <div role="menu" aria-label="便签菜单" className="absolute right-3 top-14 z-20 w-60 rounded-xl border p-3 text-sm shadow-xl" style={{ backgroundColor: palette.background, borderColor: palette.border }}>
      <p className="mb-2 text-xs font-medium opacity-70">便签颜色</p>
      <div className="mb-3 grid grid-cols-6 gap-1.5">{NOTE_COLORS.map((name) => <button key={name} type="button" aria-label={NOTE_PALETTE[name].label} title={NOTE_PALETTE[name].label} aria-pressed={colorName === name} disabled={!note} onClick={() => edit({ color: name })} className="flex size-7 items-center justify-center rounded-full border-2 disabled:opacity-40" style={{ backgroundColor: NOTE_PALETTE[name].background, borderColor: colorName === name ? palette.ink : NOTE_PALETTE[name].border }}>{colorName === name && <Check className="size-3.5" />}</button>)}</div>
      <label className="mb-3 flex items-center justify-between gap-2">纸张样式<select aria-label="便签模板" disabled={!note || changing} value={note?.template || "blank"} onChange={(e) => edit({ template: e.target.value })} className="rounded border bg-white/50 px-2 py-1" style={{ borderColor: palette.border }}><option value="blank">空白</option><option value="lined">横线</option></select></label>
      {desktop && <div className="mb-3">
        <p className="mb-1.5 text-xs font-medium opacity-70">窗口位置</p>
        <div role="radiogroup" aria-label="窗口位置" className={`grid gap-1 rounded-lg p-0.5 ${isMac ? "grid-cols-3" : "grid-cols-2"}`} style={{ backgroundColor: "rgba(0,0,0,0.06)" }}>
          {(isMac ? (["normal", "desktop", "top"] as const) : (["normal", "top"] as const)).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={layer === value} onClick={() => void chooseLayer(value)} className="rounded-md px-1 py-1 text-xs transition-colors" style={layer === value ? { backgroundColor: palette.background, boxShadow: "0 1px 2px rgba(0,0,0,0.15)" } : { opacity: 0.75 }}>
              {value === "normal" ? "普通窗口" : value === "desktop" ? "只在桌面" : "置顶"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed opacity-70">
          {layer === "desktop" ? "一直待在所有窗口下面，不会挡住你打开的页面。要编辑时，点菜单栏图标里的「显示便利贴」，它会临时浮上来，点别处后回到桌面。"
            : layer === "top" ? "一直浮在所有窗口最上面。"
            : "和普通窗口一样，打开别的窗口或页面时会被盖住。"}
        </p>
      </div>}
      <div className="space-y-0.5 border-t pt-2" style={{ borderColor: palette.border }}>
        <button type="button" role="menuitemcheckbox" aria-checked={onLogin} disabled={!desktop} onClick={() => void toggleLogin()} className="block w-full rounded px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40">{onLogin ? "✓ " : ""}开机显示便利贴</button>
        <button type="button" role="menuitem" disabled={!note || !desktop} onClick={() => { if (note) void window.desktopProductivity?.open("notes", note.id, true); setMenuOpen(false); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40">在新窗口打开</button>
        <button type="button" role="menuitem" onClick={openMain} className="block w-full rounded px-2 py-1.5 text-left hover:bg-black/5">打开求职罗盘</button>
        <button type="button" role="menuitem" disabled={!note} onClick={() => void remove()} className="block w-full rounded px-2 py-1.5 text-left text-red-700 hover:bg-red-500/10 disabled:opacity-40">删除便签</button>
      </div>
    </div>}

    {note ? <textarea disabled={changing} aria-label="便签正文" className="min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 text-base leading-8 outline-none placeholder:opacity-50" style={note.template === "lined" ? { backgroundImage: `repeating-linear-gradient(transparent,transparent 31px,${palette.border} 32px)`, backgroundPosition: "0 8px" } : undefined} placeholder="写下今天想记住的事…" value={note.content} maxLength={100000} onChange={(e) => edit({ content: e.target.value })} /> : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center"><StickyNote className="size-10 opacity-30" /><p className="text-sm opacity-70">一张轻便的桌面便签，随手记下灵感和待办。</p><button type="button" disabled={changing} onClick={add} className="rounded-full border px-4 py-1.5 text-sm hover:bg-white/30" style={{ borderColor: palette.border }}>新建便签</button></div>}
    {conflict && <button className="px-4 text-left text-xs underline" onClick={async () => { if (!confirm("放弃本窗口草稿并重新加载？请先复制需要保留的文字。")) return; localStorage.removeItem(draftKey(note?.id || "")); blocked.current = false; setConflict(false); dirty.current = false; if (note) await switchNote(note.id); }}>重新加载</button>}
    <p role="status" className="shrink-0 px-5 pb-2 text-[11px] opacity-60">{status}</p>
  </main>;
}
