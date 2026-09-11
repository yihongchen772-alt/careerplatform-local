"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookmarkPlus, Mic, RefreshCw, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { startChunkedRecording, type ChunkedRecorder } from "@/lib/interview-recorder";
import type { InterviewRecordingDTO } from "@/lib/interview-recording";
import {
  deleteRecording,
  fileRecordingToLibrary,
  retryRecordingProcessing,
} from "@/lib/actions/interview-recording";
import type { WhisperStatus } from "@/types/desktop-bridge";

type ApplicationOption = { id: string; label: string; stageLabel: string };

const NONE = "__none__";

const STATUS_LABEL: Record<InterviewRecordingDTO["status"], string> = {
  RECORDING: "录音中",
  TRANSCRIBING: "转写中",
  REVIEWING: "生成复盘中",
  DONE: "已完成",
  FAILED: "失败",
};

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecorderWorkbench({
  applications,
  recordings,
  selected,
  hasOwnKey,
}: {
  applications: ApplicationOption[];
  recordings: InterviewRecordingDTO[];
  selected: InterviewRecordingDTO | null;
  hasOwnKey: boolean;
}) {
  return (
    <div className="space-y-6">
      <Recorder applications={applications} hasOwnKey={hasOwnKey} />
      {selected && <RecordingDetail key={selected.id} initial={selected} />}
      {recordings.length > 0 && <RecordingList recordings={recordings} selectedId={selected?.id ?? null} />}
    </div>
  );
}

function Recorder({ applications, hasOwnKey }: { applications: ApplicationOption[]; hasOwnKey: boolean }) {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? NONE);
  const [title, setTitle] = useState("");
  const [systemAudio, setSystemAudio] = useState(false);
  const [recorder, setRecorder] = useState<ChunkedRecorder | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [savedChunks, setSavedChunks] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);
  const startedAt = useRef(0);

  const isDesktop = typeof window !== "undefined" && !!window.desktopWhisper;
  const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

  useEffect(() => {
    const api = window.desktopWhisper;
    if (!api) return;
    api.getStatus().then(setWhisper).catch(() => {});
    return api.onStatus(setWhisper);
  }, []);

  useEffect(() => {
    if (!recorder) return;
    const timer = setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000);
      setLevel(recorder.level());
    }, 200);
    return () => clearInterval(timer);
  }, [recorder]);

  const defaultTitle = () => {
    const app = applications.find((a) => a.id === applicationId);
    const date = new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    return app ? `${app.label} · ${app.stageLabel} ${date}` : `面试 ${date}`;
  };

  async function handleStart() {
    if (recorder) return;
    const finalTitle = title.trim() || defaultTitle();
    try {
      const res = await fetch("/api/interview-recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: finalTitle, applicationId: applicationId === NONE ? null : applicationId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "创建录音失败");
      const { id } = (await res.json()) as { id: string };
      setRecordingId(id);
      setSavedChunks(0);
      const r = await startChunkedRecording({
        systemAudio,
        onChunk: async (index, wav, durationSec) => {
          const form = new FormData();
          form.append("index", String(index));
          form.append("durationSec", String(durationSec));
          form.append("audio", wav, `chunk-${index}.wav`);
          let lastError = "";
          for (let attempt = 0; attempt < 3; attempt++) {
            const up = await fetch(`/api/interview-recordings/${id}/chunks`, { method: "POST", body: form }).catch(
              () => null
            );
            if (up?.ok) {
              setSavedChunks((n) => n + 1);
              return;
            }
            lastError = up ? (await up.json().catch(() => ({}))).error || `HTTP ${up.status}` : "网络错误";
          }
          throw new Error(`第 ${index + 1} 段没保存上（${lastError}）`);
        },
        onError: (message) => toast.error(message),
      });
      startedAt.current = Date.now();
      setElapsed(0);
      setRecorder(r);
      if (systemAudio && !r.systemAudioActive) {
        toast.info(isWindows ? "没拿到系统声音，只录了麦克风" : "Mac 上录不了系统声音，只录麦克风——面试时请用外放，别戴耳机");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "开始录音失败——检查麦克风权限");
    }
  }

  async function handleStop() {
    if (!recorder || !recordingId || stopping) return;
    setStopping(true);
    try {
      await recorder.stop();
      const res = await fetch(`/api/interview-recordings/${recordingId}/finish`, { method: "POST" });
      if (!res.ok) throw new Error("结束录音失败");
      toast.success("录音已保存，开始转写");
      router.push(`/interview-recorder?id=${recordingId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "结束录音失败");
    } finally {
      setRecorder(null);
      setRecordingId(null);
      setStopping(false);
    }
  }

  const transcriberNote = !isDesktop
    ? "浏览器里跑的话只能用 Gemini 转写。"
    : whisper?.activeModel
      ? `本地转写已就绪（${whisper.models[whisper.activeModel].label.split("（")[0]}），录音不会离开这台电脑。`
      : "还没下载本地转写模型——会用 Gemini 转写（录音会发给 Google）。想全程本地，去「账号设置 → 面试录音」下载模型。";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{recorder ? "录音中" : "开始一场录音"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!recorder ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">这是哪场面试</Label>
                <Select value={applicationId} onValueChange={(v) => v && setApplicationId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {() =>
                        applicationId === NONE
                          ? "不关联投递"
                          : (applications.find((a) => a.id === applicationId)?.label ?? "选投递")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>不关联投递</SelectItem>
                    {applications.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}（{a.stageLabel}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">标题（可不填）</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle()} />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={systemAudio} onCheckedChange={(v) => setSystemAudio(v === true)} className="mt-0.5" />
              <span>
                同时录系统声音（线上面试用）
                <span className="block text-xs text-muted-foreground">
                  {isWindows
                    ? "会弹一个屏幕选择框，随便选一个即可——只取声音不录画面。"
                    : "Mac 上系统不允许直接录，这个选项没用；请把面试外放、靠麦克风把面试官声音一起录进去。"}
                </span>
              </span>
            </label>
            <p className="text-xs text-muted-foreground">{transcriberNote}</p>
            {!hasOwnKey && (
              <p className="text-xs text-destructive">复盘要调 AI，先去账号设置配一个自己的 API Key。</p>
            )}
            <Button type="button" onClick={handleStart} disabled={!hasOwnKey}>
              <Mic className="size-4" />
              开始录音
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="font-mono text-4xl tabular-nums">{formatDuration(elapsed)}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.min(100, Math.round(level * 140))}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              每 5 分钟自动存一段，已存 {savedChunks} 段
              {recorder.systemAudioActive ? " · 麦克风 + 系统声音" : " · 仅麦克风"}
              。中途关掉也不会丢已存的部分。
            </p>
            <Button type="button" variant="destructive" disabled={stopping} onClick={handleStop}>
              <Square className="size-4" />
              {stopping ? "正在保存最后一段…" : "结束并开始复盘"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecordingDetail({ initial }: { initial: InterviewRecordingDTO }) {
  const router = useRouter();
  const [rec, setRec] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const processing = rec.status === "TRANSCRIBING" || rec.status === "REVIEWING";

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/interview-recordings/${rec.id}`).catch(() => null);
      if (!res?.ok) return;
      const next = (await res.json()) as InterviewRecordingDTO;
      setRec(next);
      // The history list below is server-rendered; pull it up to date once
      // this one settles so it stops saying 转写中.
      if (next.status === "DONE" || next.status === "FAILED") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [processing, rec.id, router]);

  async function handleFile() {
    setBusy("file");
    try {
      const res = await fileRecordingToLibrary(rec.id);
      if (!res.ok) return void toast.error(res.message);
      toast.success("已存进面经库，问题清单也一并整理好了");
      setRec((r) => ({ ...r, stageHistoryId: res.data.stageHistoryId }));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleRetry() {
    setBusy("retry");
    try {
      const res = await retryRecordingProcessing(rec.id);
      if (!res.ok) return void toast.error(res.message);
      setRec((r) => ({ ...r, status: "TRANSCRIBING", error: null, review: null }));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!window.confirm("删除这段录音和它的复盘？音频文件会一起删掉。")) return;
    setBusy("delete");
    try {
      const res = await deleteRecording(rec.id);
      if (!res.ok) return void toast.error(res.message);
      router.push("/interview-recorder");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{rec.title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {rec.applicationLabel ?? "未关联投递"} · {formatDuration(rec.durationSec)} ·{" "}
              {new Date(rec.startedAt).toLocaleString("zh-CN")}
              {rec.transcriber && ` · ${rec.transcriber === "whisper-local" ? "本地转写" : "Gemini 转写"}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={rec.status === "DONE" ? "default" : rec.status === "FAILED" ? "destructive" : "secondary"}>
              {STATUS_LABEL[rec.status]}
            </Badge>
            {rec.status === "DONE" && rec.applicationId && (
              <Button type="button" size="sm" disabled={busy !== null} onClick={handleFile}>
                <BookmarkPlus className="size-4" />
                {rec.stageHistoryId ? "更新面经库" : "存入面经库"}
              </Button>
            )}
            {(rec.status === "FAILED" || rec.status === "DONE") && (
              <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={handleRetry} title="重新转写还没转的片段并重新生成复盘">
                <RefreshCw className="size-4" />
                重新生成复盘
              </Button>
            )}
            <Button type="button" size="icon" variant="ghost" aria-label="删除录音" disabled={busy !== null} onClick={handleDelete}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {processing && (
          <div className="rounded-md border bg-muted/30 p-4 text-sm">
            {rec.status === "TRANSCRIBING" ? (
              <>
                正在转写：{rec.chunksTranscribed} / {rec.chunksTotal} 段
                {rec.transcriber === "whisper-local" ? "（本地 whisper，取决于电脑速度，5 分钟音频大约 1-3 分钟）" : "（Gemini）"}
              </>
            ) : (
              "转写完了，AI 正在写复盘…"
            )}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${rec.status === "REVIEWING" ? 95 : rec.chunksTotal ? Math.round((rec.chunksTranscribed / rec.chunksTotal) * 90) : 5}%`,
                }}
              />
            </div>
          </div>
        )}
        {rec.status === "FAILED" && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{rec.error}</p>
        )}
        {rec.stageHistoryId && (
          <p className="text-xs text-muted-foreground">
            已存入面经库 →{" "}
            <Link href="/interviews" className="text-primary underline underline-offset-4">
              去看看
            </Link>
          </p>
        )}

        {rec.review && <ReviewView review={rec.review} />}

        {rec.transcript && (
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">转写全文</summary>
            <pre className="max-h-96 overflow-auto px-3 pb-3 font-sans text-xs whitespace-pre-wrap text-muted-foreground">
              {rec.transcript}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewView({ review }: { review: NonNullable<InterviewRecordingDTO["review"]> }) {
  return (
    <div className="space-y-5 text-sm">
      <p className="rounded-md bg-muted/40 p-3">{review.summary}</p>

      {review.questions.length > 0 && (
        <div className="space-y-3">
          <p className="font-medium">问到的问题（{review.questions.length}）</p>
          {review.questions.map((q, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">
                  {i + 1}. {q.question}
                </p>
                <Badge variant="secondary" className="shrink-0">
                  {q.category}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">你的回答</p>
              <p className="text-muted-foreground">{q.yourAnswer}</p>
              <p className="mt-2 text-xs text-muted-foreground">点评</p>
              <p>{q.assessment}</p>
              <p className="mt-2 text-xs text-muted-foreground">更好的说法</p>
              <p className="text-muted-foreground">{q.betterAnswer}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <ListBlock title="做得好的" items={review.strengths} />
        <ListBlock title="要改的" items={review.improvements} />
        <ListBlock title="要补的知识点" items={review.knowledgeGaps} />
      </div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 font-medium">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function RecordingList({ recordings, selectedId }: { recordings: InterviewRecordingDTO[]; selectedId: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>历史录音</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {recordings.map((r) => (
            <li key={r.id}>
              <Link
                href={`/interview-recorder?id=${r.id}`}
                className={`flex items-center justify-between gap-3 py-2.5 text-sm ${r.id === selectedId ? "font-medium" : ""}`}
              >
                <span className="min-w-0 truncate">
                  {r.title}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatDuration(r.durationSec)} · {new Date(r.startedAt).toLocaleDateString("zh-CN")}
                  </span>
                </span>
                <Badge variant={r.status === "DONE" ? "outline" : r.status === "FAILED" ? "destructive" : "secondary"}>
                  {STATUS_LABEL[r.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
