"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createNote, deleteNote, listNotes, saveNote } from "@/lib/actions/productivity";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
type Note = Awaited<ReturnType<typeof listNotes>>[number];
function draftKey(id: string) { return `jobcompass:note-draft:${id}:${new URLSearchParams(location.search).get("window") || "browser"}`; }
export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const current = useRef<Note | null>(null);
  const dirty = useRef(false), saving = useRef(false), blocked = useRef(false);
  const [changing, setChanging] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState("正在加载"), [pinned, setPinned] = useState(false);
  const flush = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot || !dirty.current || saving.current || blocked.current) return false;
    saving.current = true;
    try {
      const result = await saveNote(snapshot);
      if (!result.ok) { blocked.current = true; setConflict(true); setStatus(result.message); return false; }
      if (current.current?.id === snapshot.id) {
        const unchanged = current.current.content === snapshot.content && current.current.template === snapshot.template;
        current.current = { ...current.current, revision: result.data.revision };
        const savedNote = current.current;
        setNote(savedNote); dirty.current = !unchanged;
        setNotes((rows) => rows.map((row) => row.id === snapshot.id ? savedNote : row));
        if (unchanged) localStorage.removeItem(draftKey(snapshot.id));
        else localStorage.setItem(draftKey(snapshot.id), JSON.stringify({ content: current.current.content, template: current.current.template, revision: result.data.revision }));
        setStatus(unchanged ? "已保存" : "正在保存…");
      }
      return true;
    } catch { setStatus("保存失败，草稿保存在本机；将自动重试"); return false; }
    finally { saving.current = false; }
  }, []);
  function select(row: Note) {
    let restored = row; blocked.current = false; setConflict(false);
    try { const draft = JSON.parse(localStorage.getItem(draftKey(row.id)) || "null"); if (draft && typeof draft.content === "string") { restored = { ...row, content: draft.content, template: draft.template === "lined" ? "lined" : "blank" }; dirty.current = true; blocked.current = draft.revision !== row.revision && (draft.content !== row.content || draft.template !== row.template); setConflict(blocked.current); } else dirty.current = false; } catch { dirty.current = false; }
    current.current = restored; setNote(restored); setStatus(blocked.current ? "草稿与另一窗口的修改冲突，请复制正文后重新加载。" : dirty.current ? "已恢复未保存草稿" : "已保存");
    void window.desktopProductivity?.selectNote(row.id);
  }
  useEffect(() => {
    let alive = true;
    void listNotes().then((rows) => { if (!alive) return; setNotes(rows); const id = new URLSearchParams(location.search).get("id"); const row = rows.find((n) => n.id === id) || rows[0]; if (row) select(row); else setStatus("点击新建，开始写便签"); }).catch(() => setStatus("无法加载，请重新打开窗口")).finally(() => { if (alive) setChanging(false); });
    void window.desktopProductivity?.state().then((s) => setPinned(s.pinned));
    const timer = setInterval(() => { void flush(); }, 650);
    const unload = () => { if (dirty.current) void flush(); };
    window.addEventListener("beforeunload", unload);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("beforeunload", unload); void flush(); };
  }, [flush]);
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
      if (dirty.current && !await flush() || dirty.current) return;
      const r = await createNote();
      if (r.ok) { setNotes((ns) => [...ns, r.data]); select(r.data); } else toast.error(r.message);
    } catch { toast.error("新建失败，请重试"); } finally { setChanging(false); }
  }
  function edit(change: Partial<Note>) {
    if (!current.current) return;
    const next = { ...current.current, ...change }; current.current = next; setNote(next); dirty.current = true; setStatus("正在保存…");
    try { localStorage.setItem(draftKey(next.id), JSON.stringify({ content: next.content, template: next.template, revision: next.revision })); } catch { setStatus("正在保存（本机草稿缓存不可用）"); }
  }
  return <main className="flex h-screen flex-col gap-2 bg-amber-50 p-3 text-stone-900">
    <div className="flex flex-wrap gap-2"><select aria-label="切换便签" disabled={changing} className="min-w-0 flex-1 rounded border bg-white p-1" value={note?.id || ""} onChange={(e) => void switchNote(e.target.value)}><option value="" disabled>选择便签</option>{notes.map((n) => <option key={n.id} value={n.id}>{(n.id === note?.id ? note.content : n.content).split("\n")[0].slice(0, 24) || "空白便签"}</option>)}</select><Button size="sm" disabled={changing} onClick={add}>新建</Button></div>
    {note && <><div className="flex flex-wrap gap-2 text-xs"><select disabled={changing} aria-label="便签模板" value={note.template} onChange={(e) => edit({ template: e.target.value })}><option value="blank">空白</option><option value="lined">横线</option></select><button onClick={async () => { if (window.desktopProductivity) setPinned(await window.desktopProductivity.pin(!pinned)); }}>{pinned ? "取消置顶" : "置顶"}</button><button onClick={() => void window.desktopProductivity?.open("notes", note.id, true)}>在新窗口打开</button><button onClick={async () => { if (!confirm("删除这张便签？关联日程会保留。")) return; if (saving.current) return; const r = await deleteNote(note.id); if (!r.ok) return toast.error(r.message); localStorage.removeItem(draftKey(note.id)); dirty.current = false; current.current = null; setNote(null); const rows = await listNotes(); setNotes(rows); if (rows[0]) select(rows[0]); }}>删除</button></div><textarea disabled={changing} aria-label="便签正文" className="min-h-0 flex-1 resize-none border-0 bg-transparent p-2 text-base leading-8 outline-none" style={note.template === "lined" ? { backgroundImage: "repeating-linear-gradient(transparent,transparent 31px,#d6c99a 32px)", backgroundPosition: "0 8px" } : undefined} placeholder="点击就能写，不需要标题或日期…" value={note.content} maxLength={100000} onChange={(e) => edit({ content: e.target.value })} /></>}
    {conflict && <button className="text-xs underline" onClick={async () => { if (!confirm("放弃本窗口草稿并重新加载？请先复制需要保留的文字。")) return; localStorage.removeItem(draftKey(note?.id || "")); blocked.current = false; setConflict(false); dirty.current = false; if (note) await switchNote(note.id); }}>重新加载</button>}
    <p role="status" className="text-xs text-stone-600">{status}</p>
  </main>;
}
