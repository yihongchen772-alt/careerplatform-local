"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileText,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AiProgress } from "@/components/ui/ai-progress";
import { PageHero } from "@/components/layout/page-hero";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  changeState,
  changedAddresses,
  diffText,
  docPlainText,
  renderResumeBody,
  renderResumeHtml,
  renderResumeWord,
  resumeDocSchema,
  richFromNode,
  stripBold,
  textAt,
  withChange,
  withHidden,
  withParaAfter,
  withText,
  withoutPara,
  type ResumeDoc,
  type TailorChange,
  type TailorDraft,
} from "@/lib/resume-doc";
import { deleteTailoring, generateTailoring, saveTailoringAsVersion, saveTailoringDoc } from "@/lib/actions/resume-tailor";
import type { TailorResumeOption } from "@/components/resumes/tailor-start";
import { NativeSelect } from "@/components/ui/native-select";

const PAGE_PX = (297 * 96) / 25.4;
// The preview's page: styles only. The body is drawn by paintFrame, so the frame never reloads.
const FRAME_SHELL = renderResumeHtml(resumeDocSchema.parse({}), "定制简历预览", { editable: true });
const PARA = /^[pc]\d+$/;

function Diff({ before, after }: { before: string; after: string }) {
  const a = stripBold(before);
  const b = stripBold(after);
  if (a === b) return <p className="text-sm">{b} <span className="text-xs text-muted-foreground">（只调整了加粗重点）</span></p>;
  const parts = diffText(a, b);
  // Moved-around lists (tech stack, skills) diff into confetti: show new and old whole instead.
  const sameItems = [...a.replace(/\s/g, "")].sort().join("") === [...b.replace(/\s/g, "")].sort().join("");
  if (sameItems || parts.filter((part) => part.kind !== "same").length > 4) {
    return (
      <div className="space-y-0.5 text-sm">
        <p>{b}{sameItems && <span className="text-xs text-muted-foreground">（只调整了顺序）</span>}</p>
        <p className="text-xs text-muted-foreground"><span className="line-through decoration-muted-foreground/60">{a}</span></p>
      </div>
    );
  }
  return (
    <p className="text-sm leading-relaxed">
      {parts.map((part, i) =>
        part.kind === "same" ? <span key={i}>{part.text}</span>
          : part.kind === "del" ? <del key={i} className="bg-red-100 text-red-700 decoration-red-400 dark:bg-red-950/50 dark:text-red-300">{part.text}</del>
            : <ins key={i} className="bg-emerald-100 text-emerald-800 no-underline dark:bg-emerald-950/50 dark:text-emerald-300">{part.text}</ins>
      )}
    </p>
  );
}

/** A picked photo, shrunk to a print-sized JPEG so the PDF stays small. */
function photoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 900 / img.height, 700 / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("读不了这张图片"));
    };
    img.src = url;
  });
}

/** Sizes the preview frame to its page (at least one A4) and returns the page's height in CSS px. */
function sizeFrame(frame: HTMLIFrameElement | null): number | null {
  const page = frame?.contentDocument?.querySelector<HTMLElement>(".page");
  if (!frame || !page) return null;
  const height = page.scrollHeight;
  frame.style.height = `${Math.ceil(Math.max(PAGE_PX, height)) + 4}px`;
  return height;
}

/** The largest font scale, from `from` down to `min`, at which the page fits one A4 — null if none does. */
function scaleToFit(frame: HTMLIFrameElement | null, from: number, min: number): number | null {
  const page = frame?.contentDocument?.querySelector<HTMLElement>(".page");
  if (!page) return null;
  let scale = from;
  while (page.scrollHeight > PAGE_PX + 2 && scale > min) {
    scale = Math.round((scale - 0.01) * 100) / 100;
    page.style.setProperty("--s", String(scale));
  }
  const fits = page.scrollHeight <= PAGE_PX + 2;
  page.style.setProperty("--s", String(from));
  return fits ? scale : null;
}

/** Draws the document into the preview with every text editable, then puts the caret where asked. */
function paintFrame(frame: HTMLIFrameElement | null, doc: ResumeDoc, changes: TailorChange[], showChanges: boolean, focusId: string | null) {
  const d = frame?.contentDocument;
  if (!d?.body) return;
  d.body.innerHTML = renderResumeBody(doc, { editable: true, changed: changedAddresses(doc, changes) });
  d.body.classList.toggle("cp-off", !showChanges);
  d.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
    el.contentEditable = "true";
    el.spellcheck = false;
  });
  const el = focusId ? d.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`) : null;
  if (!el) return;
  el.focus();
  const range = d.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = d.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function TailorWorkbench({
  id,
  back,
  draft,
  baseResume,
  savedVersion,
  resumes,
}: {
  id: string;
  back: React.ReactNode;
  draft: TailorDraft & { doc: ResumeDoc };
  baseResume: { id: string; name: string; fileUrl: string | null };
  savedVersion: { id: string; name: string } | null;
  resumes: TailorResumeOption[];
}) {
  const router = useRouter();
  const { target, changes } = draft;
  const heading = [target.company, target.title].filter(Boolean).join(" · ") || "按 JD 定制";
  const fileBase = `${draft.doc.name || "简历"}-${[target.company, target.title].filter(Boolean).join("-") || "定制"}`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<ResumeDoc>(draft.doc);
  const docRef = useRef<ResumeDoc>(draft.doc);
  const savedRef = useRef<ResumeDoc>(draft.doc);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const saveTimer = useRef<number | null>(null);
  const frozen = useRef(false);
  const [showChanges, setShowChanges] = useState(true);
  const showRef = useRef(true);
  const [overflow, setOverflow] = useState(0);
  const pendingFocus = useRef<string | null>(null);
  const [busy, setBusy] = useState<null | "version" | "pdf" | "doc" | "regen" | "delete">(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [versionName, setVersionName] = useState(savedVersion?.name ?? `定制·${[target.company, target.title].filter(Boolean).join("·") || "按 JD"}`.slice(0, 60));
  const [asNew, setAsNew] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenMode, setRegenMode] = useState(draft.mode);
  const [regenResume, setRegenResume] = useState(baseResume.id);
  const [rereadBase, setRereadBase] = useState(false);
  const [showJd, setShowJd] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  // ── saving ──
  const flush = useCallback(async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (frozen.current || docRef.current === savedRef.current) return true;
    const sending = docRef.current;
    setSaveState("saving");
    const result = await saveTailoringDoc(id, sending);
    if (!result.ok) {
      setSaveState("error");
      toast.error(`自动保存失败：${result.message}`);
      return false;
    }
    savedRef.current = sending;
    setSaveState(docRef.current === sending ? "saved" : "pending");
    return true;
  }, [id]);

  const commit = useCallback((next: ResumeDoc) => {
    docRef.current = next;
    setDoc(next);
    setSaveState("pending");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 900);
  }, [flush]);

  useEffect(() => {
    const leave = () => void flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      void flush();
    };
  }, [flush]);

  // ── the preview ──
  const measure = useCallback(() => {
    const height = sizeFrame(frameRef.current);
    // A couple of px is rounding, not a second page.
    if (height !== null) setOverflow(height - PAGE_PX > 2 ? Math.round(height - PAGE_PX) : 0);
  }, []);

  const paint = useCallback(() => {
    paintFrame(frameRef.current, docRef.current, changes, showRef.current, pendingFocus.current);
    pendingFocus.current = null;
    measure();
  }, [changes, measure]);

  // A version that runs a few lines over one page is shrunk to fit once, on first open —
  // a resume that spills onto page 2 is the worse surprise. Changeable with 字号 − / +.
  const autoFitted = useRef(false);

  const restructure = useCallback((next: ResumeDoc, focus?: string) => {
    pendingFocus.current = focus ?? null;
    commit(next);
    paint();
  }, [commit, paint]);

  const flash = useCallback((address: string) => {
    const el = frameRef.current?.contentDocument?.querySelector<HTMLElement>(`[data-id="${CSS.escape(address)}"]`);
    if (!el) return;
    // Scrolls the app's own scroll area too: the frame is same-origin.
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("cp-flash");
    void el.offsetWidth;
    el.classList.add("cp-flash");
  }, []);

  const wiredDoc = useRef<Document | null>(null);
  const wire = useCallback(() => {
    const d = frameRef.current?.contentDocument;
    // Once per document: a second set of listeners would add two bullets per Enter.
    if (!d?.body || wiredDoc.current === d) return;
    wiredDoc.current = d;
    paint();
    if (docRef.current.autoFit && !autoFitted.current) {
      autoFitted.current = true;
      const from = docRef.current.fontScale;
      const scale = scaleToFit(frameRef.current, from, 0.9);
      commit({ ...docRef.current, autoFit: undefined, fontScale: scale ?? from });
      if (scale !== null && scale !== from) {
        paint();
        toast.info(`为了保持一页，字号自动缩到 ${Math.round(scale * 100)}%，右侧「字号」可以调回`);
      }
    }
    const holder = (node: EventTarget | null) => (node instanceof d.defaultView!.Node ? (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest<HTMLElement>("[data-id]") ?? null : null);
    d.addEventListener("input", (event) => {
      const el = holder(event.target);
      if (!el?.dataset.id) return;
      const next = withText(docRef.current, el.dataset.id, richFromNode(el));
      if (next !== docRef.current) commit(next);
      measure();
    });
    d.addEventListener("keydown", (event) => {
      const el = holder(event.target);
      const address = el?.dataset.id;
      if (!el || !address) return;
      if (event.key === "Enter") {
        event.preventDefault();
        // A new line below — for bullets and plain lines; elsewhere Enter just finishes.
        if (/^p\d+$/.test(address)) {
          const { doc: next, id: added } = withParaAfter(docRef.current, address);
          restructure(next, added);
        } else el.blur();
        return;
      }
      if (event.key === "Backspace" && /^p\d+$/.test(address) && !(el.textContent ?? "").trim()) {
        event.preventDefault();
        const all = Array.from(d.querySelectorAll<HTMLElement>("[data-id]")).filter((node) => PARA.test(node.dataset.id ?? ""));
        const previous = all[all.indexOf(el) - 1]?.dataset.id;
        restructure(withoutPara(docRef.current, address), previous);
      }
    });
    d.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/g, " ");
      d.execCommand("insertText", false, text);
    });
    d.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest?.<HTMLElement>("[data-act]");
      if (!button?.dataset.target) return;
      event.preventDefault();
      restructure(withHidden(docRef.current, button.dataset.target, button.dataset.act === "hide"));
    });
  }, [commit, measure, paint, restructure]);


  // Drawn from an effect, not only onLoad: after a full page load the frame has
  // usually finished loading before React hydrates, and that load event is gone.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ready = () => wire();
    if (frame.contentDocument?.readyState === "complete") ready();
    frame.addEventListener("load", ready);
    return () => frame.removeEventListener("load", ready);
  }, [wire]);

  function toggleChanges() {
    showRef.current = !showRef.current;
    setShowChanges(showRef.current);
    frameRef.current?.contentDocument?.body.classList.toggle("cp-off", !showRef.current);
  }

  function setChange(change: TailorChange, on: boolean) {
    restructure(withChange(docRef.current, change, on));
    if (change.kind === "text") window.setTimeout(() => flash(change.address), 30);
  }

  function setScale(scale: number) {
    restructure({ ...docRef.current, fontScale: Math.min(1.05, Math.max(0.85, Math.round(scale * 100) / 100)) });
  }

  function fitToPage() {
    const scale = scaleToFit(frameRef.current, docRef.current.fontScale, 0.86);
    if (scale === null) {
      restructure({ ...docRef.current, fontScale: 0.86 });
      toast.warning("字号缩到最小还是超出一点：可以把一段不太相关的经历「隐藏」，或删几句");
      return;
    }
    restructure({ ...docRef.current, fontScale: scale });
    toast.success(`已缩到一页（字号 ${Math.round(scale * 100)}%）`);
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      restructure({ ...docRef.current, photo: await photoDataUrl(file) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读不了这张图片");
    }
  }

  async function exportFile(format: "pdf" | "doc") {
    setBusy(format);
    try {
      await flush();
      const html = format === "pdf" ? renderResumeHtml(docRef.current, fileBase) : renderResumeWord(docRef.current, fileBase);
      if (window.desktopBridge?.exportDocument) {
        await window.desktopBridge.exportDocument({ format, html, fileName: fileBase });
        toast.success(`已导出到「下载」文件夹（${format === "pdf" ? "PDF" : "Word .doc，可以用 Word / WPS 继续改"}）`);
      } else {
        const blob = new Blob([html], { type: format === "pdf" ? "text/html" : "application/msword" });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement("a"), { href: url, download: `${fileBase}.${format === "pdf" ? "html" : "doc"}` }).click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(null);
    }
  }

  async function saveVersion() {
    setBusy("version");
    try {
      if (!(await flush())) return;
      const result = await saveTailoringAsVersion(id, versionName, { asNew });
      if (!result.ok) return void toast.error(result.message);
      setSaveOpen(false);
      setAsNew(false);
      toast.success(result.data.updated ? `已更新简历版本「${result.data.name}」的 PDF` : `已存为简历版本「${result.data.name}」，一键填写时可以选它上传`, {
        action: { label: "去网申浏览器", onClick: () => router.push("/browser") },
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // What the AI produced, before any hand edits — to know whether regenerating loses work.
  const generatedText = useMemo(() => {
    if (!draft.base) return null;
    let generated = draft.base;
    for (const change of changes) if (change.kind !== "text" || !change.flag) generated = withChange(generated, change, true);
    return docPlainText(generated);
  }, [draft.base, changes]);
  const handEdited = generatedText !== null && docPlainText(doc) !== generatedText;

  async function regenerate() {
    if (handEdited && !window.confirm("重新生成会换掉你在预览里改过的内容，继续？")) return;
    frozen.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setBusy("regen");
    try {
      const result = await generateTailoring(id, { mode: regenMode, resumeVersionId: regenResume, refreshBase: rereadBase });
      if (!result.ok) {
        frozen.current = false;
        return void toast.error(result.message);
      }
      if (result.data.status === "needs-resume-text") {
        frozen.current = false;
        return void toast.error(result.data.reason);
      }
      toast.success(`重新生成好了：${result.data.changes} 处改动`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(savedVersion ? `删除这份定制？已经存成的简历版本「${savedVersion.name}」会保留。` : "删除这份定制？它还没存成简历版本，删了就没有了。")) return;
    frozen.current = true;
    setBusy("delete");
    const result = await deleteTailoring(id);
    if (!result.ok) {
      frozen.current = false;
      setBusy(null);
      return void toast.error(result.message);
    }
    router.push("/resumes");
  }

  const states = changes.map((change) => changeState(doc, change));
  const applied = states.filter((s) => s === "applied").length;
  const childLabel = (childId: string) => {
    const base = draft.base ?? doc;
    for (const section of base.sections) {
      const entry = section.entries.find((e) => e.id === childId);
      if (entry) return stripBold(entry.title || entry.subtitle).slice(0, 16);
    }
    const text = textAt(base, childId);
    return text ? `${stripBold(text).slice(0, 12)}…` : childId;
  };

  return (
    <div className="space-y-4">
      <PageHero
        back={back}
        title="定制简历"
        icon={Wand2}
        description={<>{heading}　在「{baseResume.name}」上微调{savedVersion ? <>，已存为简历版本「{savedVersion.name}」</> : null}</>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setSaveOpen(true)} disabled={busy !== null}>
              {busy === "version" ? <Loader2 className="animate-spin" /> : <Save />}
              {savedVersion ? "更新简历版本" : "存为简历版本"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" disabled={busy !== null} />}>
                {busy === "pdf" || busy === "doc" ? <Loader2 className="animate-spin" /> : <Download />}导出<ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void exportFile("pdf")}><FileText />PDF 到「下载」</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportFile("doc")}><FileText />Word 到「下载」（在 Word / WPS 里继续改）</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 max-w-full space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <button type="button" onClick={toggleChanges} className="inline-flex items-center gap-1 hover:text-foreground">
              {showChanges ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {showChanges ? "黄色是 AI 改过的地方" : "改动标记已隐藏"}
            </button>
            <span>点任何文字直接改 · ⌘B 加粗 · 回车在下面加一条 · 条目右侧可「隐藏」</span>
            <span className="ml-auto">{saveState === "saving" ? "保存中…" : saveState === "pending" ? "有改动，马上自动保存" : saveState === "error" ? "保存失败" : "已自动保存"}</span>
          </div>
          <div className="overflow-auto rounded-lg border bg-muted/40 p-3">
            <iframe
              ref={frameRef}
              title="定制简历预览"
              srcDoc={FRAME_SHELL}
              className="block w-[210mm] rounded bg-white shadow-md"
              style={{ height: `${Math.ceil(PAGE_PX) + 4}px` }}
            />
          </div>
        </div>

        <aside aria-label="改动和设置" className="w-full min-w-[300px] flex-1 space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:max-w-[420px] lg:overflow-auto">
          <section className={cn("space-y-2 rounded-xl border p-3", overflow > 0 ? "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30" : "")}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{overflow > 0 ? `超出一页（多约 ${Math.max(1, Math.round(overflow / 18))} 行）` : "刚好一页"}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                字号
                <Button size="icon-xs" variant="ghost" aria-label="缩小字号" disabled={doc.fontScale <= 0.85} onClick={() => setScale(doc.fontScale - 0.02)}><Minus /></Button>
                <span className="w-9 text-center tabular-nums">{Math.round(doc.fontScale * 100)}%</span>
                <Button size="icon-xs" variant="ghost" aria-label="放大字号" disabled={doc.fontScale >= 1.05} onClick={() => setScale(doc.fontScale + 0.02)}><Plus /></Button>
              </div>
            </div>
            {overflow > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={fitToPage}>自动缩到一页</Button>
                <span className="text-xs text-muted-foreground">或者隐藏一段不太相关的经历</span>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">AI 改了 {changes.length} 处{changes.length ? `，现在用着 ${applied} 处` : ""}</p>
              {draft.summary && <p className="mt-1 text-xs text-muted-foreground">{draft.summary}</p>}
            </div>
            {changes.length === 0 && <p className="text-sm text-muted-foreground">没有需要改的地方：这份简历和 JD 已经很贴合了。可以直接在预览里改，或换「也调整顺序」重新生成。</p>}
            <ol className="space-y-2">
              {changes.map((change, index) => {
                const state = states[index];
                return (
                  <li key={change.kind === "text" ? change.address : `order:${change.parent}`} className={cn("space-y-1.5 rounded-lg border p-2.5", state === "reverted" && "opacity-70")}>
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" className="min-w-0 truncate text-left text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => change.kind === "text" && flash(change.address)} title="在预览里找到这处">
                        {change.kind === "order" ? `调整顺序：${change.label}` : change.label}
                      </button>
                      {state === "applied" ? <Badge variant="secondary" className="shrink-0"><Check />已用</Badge> : state === "reverted" ? <Badge variant="outline" className="shrink-0">原文</Badge> : <Badge variant="outline" className="shrink-0">你改过</Badge>}
                    </div>
                    {change.kind === "text" ? (
                      <Diff before={change.before} after={state === "edited" ? textAt(doc, change.address) ?? change.after : change.after} />
                    ) : (
                      <p className="text-sm">{change.after.map(childLabel).join(" → ")}<span className="block text-xs text-muted-foreground">原来：{change.before.map(childLabel).join(" → ")}</span></p>
                    )}
                    {change.reason && <p className="text-xs text-muted-foreground">{change.reason}</p>}
                    {change.kind === "text" && change.flag && (
                      <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{change.flag}，默认没用；确认属实再点「用这条」</p>
                    )}
                    <div className="flex gap-1.5">
                      {state !== "reverted" && <Button size="xs" variant="outline" onClick={() => setChange(change, false)}><Undo2 />{change.kind === "order" ? "恢复原顺序" : "改回原文"}</Button>}
                      {state !== "applied" && <Button size="xs" variant="outline" onClick={() => setChange(change, true)}><Check />{state === "edited" ? "换成 AI 的版本" : "用这条"}</Button>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {draft.keywords.length > 0 && (
            <section className="space-y-2 rounded-xl border p-3">
              <p className="text-sm font-medium">JD 关键词</p>
              <div className="flex flex-wrap gap-1.5">
                {draft.keywords.map((k) => (
                  <span key={k.word} className={cn("inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs", k.covered ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "text-muted-foreground")}>
                    {k.covered && <Check className="size-3" />}{k.word}
                  </span>
                ))}
              </div>
              {draft.keywords.some((k) => !k.covered) && <p className="text-xs text-muted-foreground">灰色的是 JD 提到、但你简历里没有对应经历的，没有硬加；如果你确实有，可以在预览里自己补一句。</p>}
            </section>
          )}

          <section className="space-y-2 rounded-xl border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">照片</span>
              <Button size="xs" variant="outline" onClick={() => photoInput.current?.click()}><ImagePlus />{doc.photo ? "换一张" : "添加照片"}</Button>
              {doc.photo && <Button size="xs" variant="ghost" onClick={() => restructure({ ...docRef.current, photo: null })}>去掉照片</Button>}
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {baseResume.fileUrl && <a href={baseResume.fileUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">对照原简历 PDF</a>}
              {target.jdText && <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => setShowJd((v) => !v)}>{showJd ? "收起 JD" : "看 JD"}</button>}
              {target.url && <a href={target.url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">岗位页面</a>}
            </div>
            {showJd && <p className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">{target.jdText}</p>}
          </section>

          <section className="space-y-2 rounded-xl border p-3">
            <button type="button" className="flex w-full items-center justify-between text-sm font-medium" onClick={() => setRegenOpen((v) => !v)}>
              重新生成<ChevronDown className={cn("size-4 transition-transform", regenOpen && "rotate-180")} />
            </button>
            {regenOpen && (
              <div className="space-y-2 text-sm">
                <div className="flex gap-1.5">
                  <Button size="xs" variant={regenMode === "text" ? "default" : "outline"} onClick={() => setRegenMode("text")}>只改字句</Button>
                  <Button size="xs" variant={regenMode === "order" ? "default" : "outline"} onClick={() => setRegenMode("order")}>也调整顺序</Button>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  底稿
                  <NativeSelect size="sm" value={regenResume} onChange={(e) => setRegenResume(e.target.value)} className="flex-1">
                    {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isDefault ? "（默认）" : ""}</option>)}
                  </NativeSelect>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={rereadBase} onChange={(e) => setRereadBase(e.target.checked)} />
                  底稿和原简历对不上？重新逐字读一遍原简历
                </label>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void regenerate()}>
                  {busy === "regen" ? <Loader2 className="animate-spin" /> : <RefreshCw />}重新生成
                </Button>
                <AiProgress active={busy === "regen"} expectedSeconds={rereadBase ? 75 : 40} stages={rereadBase ? ["正在重新读取原简历…", "AI 正在对照 JD 挑要改的句子…"] : ["AI 正在对照 JD 挑要改的句子…", "正在核对有没有多出来的数字和技能…"]} />
              </div>
            )}
          </section>

          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy !== null} onClick={() => void remove()}><Trash2 />删除这份定制</Button>
        </aside>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{savedVersion && !asNew ? "更新简历版本" : "存为简历版本"}</DialogTitle>
            <DialogDescription>
              {savedVersion && !asNew
                ? `会用现在的内容重新生成「${savedVersion.name}」的 PDF。`
                : "生成一份 PDF 放进「简历版本」，网申浏览器一键填写时可以直接选它上传。"}
            </DialogDescription>
          </DialogHeader>
          <Input value={versionName} onChange={(e) => setVersionName(e.target.value)} maxLength={60} aria-label="简历版本名称" />
          {savedVersion && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
              另存为一个新的简历版本（「{savedVersion.name}」保持不变）
            </label>
          )}
          {overflow > 0 && <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="size-3.5" />现在超出一页，PDF 会有第二页。可以先「自动缩到一页」。</p>}
          <DialogFooter>
            <Button disabled={busy !== null || !versionName.trim()} onClick={() => void saveVersion()}>
              {busy === "version" ? <Loader2 className="animate-spin" /> : <Save />}
              {busy === "version" ? "正在生成 PDF…" : savedVersion && !asNew ? "更新" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

