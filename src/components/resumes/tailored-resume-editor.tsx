"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, RefreshCw, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiProgress } from "@/components/ui/ai-progress";
import { generateTailoredResume, saveTailoredResumeBody } from "@/lib/actions/resume-tailoring";
import {
  renderTailoredResumeBody,
  sanitizeResumeBody,
  wrapTailoredResumeHtml,
  wrapTailoredResumeWord,
  type TailoredContact,
  type TailoredEducation,
  type TailoredResume,
} from "@/lib/tailored-resume";

/**
 * A4 preview in an iframe (so the resume's own CSS can't touch the app and
 * the export is byte-for-byte what's shown), made editable with designMode.
 * Pastes go in as plain text, so nothing foreign ends up in the document.
 */
export function TailoredResumeEditor({
  positionId,
  resumeVersionId,
  fileBase,
  initialDocument,
  initialBody,
  contact,
  education,
}: {
  positionId: string;
  resumeVersionId: string;
  fileBase: string;
  initialDocument: TailoredResume | null;
  initialBody: string | null;
  contact: TailoredContact;
  education: TailoredEducation[];
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<string | null>(
    initialBody ?? (initialDocument ? renderTailoredResumeBody(initialDocument, contact, education) : null)
  );
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<"save" | "pdf" | "doc" | null>(null);
  const [dirty, setDirty] = useState(false);
  // Hand edits since the last generation (saved or not): regenerating would
  // replace them, so that is what the confirmation has to be about.
  const [edited, setEdited] = useState(!!initialBody);
  const autosaveTimer = useRef<number | null>(null);

  function currentBody(): string {
    const doc = frameRef.current?.contentDocument;
    return sanitizeResumeBody(doc?.body?.innerHTML ?? body ?? "");
  }

  function makeEditable() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.designMode = "on";
    // Edits save themselves a moment after typing stops — leaving the page
    // must never throw away a resume the applicant spent time polishing.
    doc.addEventListener("input", () => {
      setDirty(true);
      setEdited(true);
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => void save(true), 1500);
    });
    doc.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      doc.execCommand("insertText", false, text);
    });
  }

  async function generate() {
    if (edited && !window.confirm("重新生成会覆盖你在预览里改过的内容，继续？")) return;
    setGenerating(true);
    try {
      const res = await generateTailoredResume(positionId, resumeVersionId);
      if (!res.ok) return void toast.error(res.message);
      setBody(renderTailoredResumeBody(res.data, contact, education));
      setDirty(false);
      setEdited(false);
      toast.success("已生成。逐条核对内容是否属实，可以直接在预览里修改");
    } finally {
      setGenerating(false);
    }
  }

  async function save(quiet = false) {
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
    if (!quiet) setBusy("save");
    try {
      const next = currentBody();
      const res = await saveTailoredResumeBody(positionId, resumeVersionId, next);
      if (!res.ok) return void toast.error(`自动保存失败：${res.message}`);
      setDirty(false);
      if (!quiet) toast.success("修改已保存");
    } finally {
      if (!quiet) setBusy(null);
    }
  }

  async function exportAs(format: "pdf" | "doc") {
    if (dirty) await save(true);
    const content = currentBody();
    const html = format === "pdf" ? wrapTailoredResumeHtml(content, fileBase) : wrapTailoredResumeWord(content, fileBase);
    setBusy(format);
    try {
      if (window.desktopBridge?.exportDocument) {
        await window.desktopBridge.exportDocument({ format, html, fileName: fileBase });
        toast.success(`已导出到「下载」文件夹（${format === "pdf" ? "PDF" : "Word .doc"}）`);
      } else if (format === "pdf") {
        frameRef.current?.contentWindow?.print();
      } else {
        const url = URL.createObjectURL(new Blob([html], { type: "application/msword" }));
        const link = Object.assign(document.createElement("a"), { href: url, download: `${fileBase}.doc` });
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={generate} disabled={generating}>
          {body ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
          {generating ? "生成中…" : body ? "重新生成" : "生成定制简历"}
        </Button>
        {body && (
          <>
            <Button type="button" variant="outline" disabled={busy !== null || !dirty} onClick={() => save()}>
              <Save className="size-4" />
              {busy === "save" ? "保存中…" : dirty ? "保存修改" : "改动已自动保存"}
            </Button>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => exportAs("pdf")}>
              <Download className="size-4" />
              {busy === "pdf" ? "导出中…" : "导出 PDF"}
            </Button>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => exportAs("doc")}>
              <FileText className="size-4" />
              {busy === "doc" ? "导出中…" : "导出 Word"}
            </Button>
          </>
        )}
      </div>
      <AiProgress active={generating} expectedSeconds={45} stages={["正在读简历和 JD…", "AI 正在挑选和改写与岗位最相关的经历…", "正在排版…"]} />
      {body ? (
        <div className="overflow-auto rounded-lg border bg-muted/40 p-4">
          <iframe
            ref={frameRef}
            key={body}
            title="定制简历预览"
            srcDoc={wrapTailoredResumeHtml(body, fileBase)}
            onLoad={makeEditable}
            className="mx-auto block h-[297mm] w-[210mm] max-w-full rounded bg-white shadow-md"
          />
        </div>
      ) : (
        !generating && (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            还没有为这个岗位生成过定制简历。AI 只会从你的简历和网申资料里挑选、改写已有经历，不会编造。
          </p>
        )
      )}
    </div>
  );
}
