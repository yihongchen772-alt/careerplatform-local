"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ClipboardPaste, ListChecks, Loader2, Search, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AiProgress } from "@/components/ui/ai-progress";
import { cn } from "@/lib/utils";
import { generateTailoring, startTailoring } from "@/lib/actions/resume-tailor";

export type TailorPositionOption = { id: string; company: string; title: string; status: string; jdLength: number };
export type TailorResumeOption = { id: string; name: string; isDefault: boolean; hasBase: boolean; hasFile: boolean };
type Target = { company: string; title: string; jdText: string; url: string };

const MODES = [
  { id: "text", title: "只改字句", hint: "版式和顺序都不动，只把少量句子换成更贴合 JD 的说法" },
  { id: "order", title: "也调整顺序", hint: "另外把和 JD 最相关的经历、要点挪到前面" },
] as const;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * 按 JD 定制 setup: which JD (a 候选岗位 or pasted text), which resume to
 * start from, and how much may change. With `tailoringId` (opened from the
 * 网申浏览器) the JD is already there and only needs a look.
 */
export function TailorStart({
  tailoringId,
  positions,
  resumes,
  initialPositionId,
  initialResumeId,
  initialTarget,
  initialMode,
}: {
  tailoringId?: string;
  positions: TailorPositionOption[];
  resumes: TailorResumeOption[];
  initialPositionId?: string | null;
  initialResumeId: string;
  initialTarget?: Target;
  initialMode: "text" | "order";
}) {
  const router = useRouter();
  const [source, setSource] = useState<"position" | "paste">(tailoringId || !positions.length ? "paste" : "position");
  const [positionId, setPositionId] = useState<string | null>(initialPositionId ?? null);
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState(initialTarget?.company ?? "");
  const [title, setTitle] = useState(initialTarget?.title ?? "");
  const [jdText, setJdText] = useState(initialTarget?.jdText ?? "");
  const [extraJd, setExtraJd] = useState("");
  const [resumeId, setResumeId] = useState(initialResumeId);
  const [mode, setMode] = useState<"text" | "order">(initialMode);
  const [running, setRunning] = useState(false);
  const [rowId, setRowId] = useState<string | null>(tailoringId ?? null);
  const [needsText, setNeedsText] = useState<string | null>(null);
  const [pastedResume, setPastedResume] = useState("");

  const picked = positions.find((p) => p.id === positionId) ?? null;
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? positions.filter((p) => `${p.company} ${p.title}`.toLowerCase().includes(q)) : positions).slice(0, 80);
  }, [positions, query]);
  const resume = resumes.find((r) => r.id === resumeId) ?? resumes[0];
  const firstRead = !!resume && !resume.hasBase;

  const jdReady = source === "position" ? !!picked && (picked.jdLength >= 30 || extraJd.trim().length >= 30) : jdText.trim().length >= 30;

  async function run() {
    if (!resume) return;
    setRunning(true);
    try {
      let id = rowId;
      if (!id) {
        const started = await startTailoring(
          source === "position" && picked
            ? { positionId: picked.id, resumeVersionId: resume.id }
            : { company, title, jdText, resumeVersionId: resume.id }
        );
        if (!started.ok) return void toast.error(started.message);
        id = started.data.id;
        // Already tailored for this job with this resume: open it rather than overwrite the edits.
        if (started.data.generated) {
          toast.info("这个岗位已经用这份简历定制过，打开上次的结果；要重来可以在右侧「重新生成」");
          router.push(`/resumes/tailor?id=${encodeURIComponent(id)}`);
          return;
        }
        setRowId(id);
      }
      const overrides =
        source === "position"
          ? picked && picked.jdLength < 30 ? { jdText: extraJd } : {}
          : { company, title, jdText };
      const result = await generateTailoring(id, {
        resumeVersionId: resume.id,
        mode,
        ...overrides,
        ...(needsText && pastedResume.trim() ? { pastedResume } : {}),
      });
      if (!result.ok) return void toast.error(result.message);
      if (result.data.status === "needs-resume-text") {
        setNeedsText(result.data.reason);
        return;
      }
      const { changes, held } = result.data;
      toast.success(changes ? `改好了：${changes} 处改动${held ? `，其中 ${held} 处待你确认` : ""}。逐条看一眼，不合适的点「改回原文」` : "AI 觉得这份简历已经很贴合，没有要改的地方");
      if (tailoringId) router.refresh();
      else router.push(`/resumes/tailor?id=${encodeURIComponent(id)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Step n={1} title="岗位 JD">
        {!tailoringId && positions.length > 0 && (
          <div className="flex gap-1.5">
            <Button size="sm" variant={source === "position" ? "default" : "outline"} onClick={() => setSource("position")}><ListChecks />从岗位里选</Button>
            <Button size="sm" variant={source === "paste" ? "default" : "outline"} onClick={() => setSource("paste")}><ClipboardPaste />粘贴 JD</Button>
          </div>
        )}
        {source === "position" ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜公司或岗位" className="pl-8" aria-label="搜索岗位" />
            </div>
            <div className="max-h-72 divide-y overflow-auto rounded-lg border" role="listbox" aria-label="岗位">
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={p.id === positionId}
                  onClick={() => setPositionId(p.id)}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60", p.id === positionId && "bg-primary/5")}
                >
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", p.id === positionId && "border-primary bg-primary text-primary-foreground")}>{p.id === positionId && <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1 truncate">{p.company} · {p.title}</span>
                  {p.status && <span className="shrink-0 text-xs text-muted-foreground">{p.status}</span>}
                  {p.jdLength < 30 && <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">没存 JD</span>}
                </button>
              ))}
              {!list.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的岗位，换个词，或改用「粘贴 JD」</p>}
            </div>
            {picked && picked.jdLength < 30 && (
              <Textarea value={extraJd} onChange={(e) => setExtraJd(e.target.value)} rows={6} placeholder="这个岗位没存 JD 正文。把岗位职责和任职要求粘贴进来：" aria-label="JD 正文" />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="公司（可不填，AI 会从 JD 里认）" aria-label="公司" />
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="岗位（可不填）" aria-label="岗位" />
            </div>
            <Textarea value={jdText} onChange={(e) => setJdText(e.target.value)} rows={tailoringId ? 8 : 10} placeholder="把岗位职责、任职要求整段粘贴进来" aria-label="JD 正文" />
            {tailoringId && <p className="text-xs text-muted-foreground">这是从网申页面读到的文字，里面混了导航之类的内容也没关系，AI 只看岗位要求。</p>}
          </div>
        )}
      </Step>

      <Step n={2} title="在哪份简历上改">
        <div className="flex flex-wrap gap-2">
          {resumes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setResumeId(r.id)}
              className={cn("rounded-lg border px-3 py-1.5 text-sm", r.id === resume?.id ? "border-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}
            >
              {r.name}{r.isDefault ? "（默认）" : ""}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          选和这个岗位方向最接近的一版，改动最少。{firstRead ? "这份是第一次用：会先把原简历逐字读成可编辑的底稿（约半分钟），之后再用就不用读了。" : "这份的底稿已经读好了。"}
        </p>
      </Step>

      <Step n={3} title="改动幅度">
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn("rounded-lg border p-3 text-left", m.id === mode ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
            >
              <p className="text-sm font-medium">{m.title}{m.id === "text" ? "（推荐）" : ""}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{m.hint}</p>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">无论哪种，都只用你简历里已有的事实：不会加新经历、新技能或新数字；JD 要求而你简历里没有的，只在关键词里提示，不会硬写进去。</p>
      </Step>

      {needsText && (
        <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-700 dark:bg-amber-950/30">
          <p className="text-sm">{needsText}</p>
          <Textarea value={pastedResume} onChange={(e) => setPastedResume(e.target.value)} rows={8} placeholder="打开你的简历（Word 或 PDF），全选复制，粘贴到这里" aria-label="简历全文" />
        </section>
      )}

      <div className="space-y-2">
        <Button size="lg" disabled={running || !jdReady || !resume || (!!needsText && pastedResume.trim().length < 80)} onClick={() => void run()}>
          {running ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {running ? "正在定制…" : "开始定制"}
        </Button>
        {!jdReady && !running && <p className="text-xs text-muted-foreground">{source === "position" ? (picked ? "这个岗位还没有 JD 正文，先粘贴进来" : "先选一个岗位") : "先粘贴 JD 正文"}</p>}
        <AiProgress
          active={running}
          expectedSeconds={firstRead ? 75 : 40}
          stages={firstRead ? ["正在逐字读取原简历，做成可编辑的底稿…", "AI 正在对照 JD 挑要改的句子…", "正在核对有没有多出来的数字和技能…"] : ["AI 正在对照 JD 挑要改的句子…", "正在核对有没有多出来的数字和技能…"]}
        />
      </div>
    </div>
  );
}
