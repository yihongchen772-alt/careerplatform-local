"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { startRecording, MicAccessDeniedError, type Recorder } from "@/lib/audio-recorder";
import { Button } from "@/components/ui/button";

export function VoiceInput({ disabled, onText }: { disabled: boolean; onText: (text: string) => void }) {
  const active = useRef<Recorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.cancel(); active.current = null; abort.current?.abort(); }; }, []);
  useEffect(() => { if (state === "idle") return; const timer = setInterval(() => setSeconds((s) => s + 1), 1000); return () => clearInterval(timer); }, [state]);
  async function stop() {
    const recorder = active.current;
    if (!recorder || busy.current) return;
    active.current = null; busy.current = true; setSeconds(0); setState("transcribing");
    const controller = new AbortController(); abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 95000);
    try {
      const recording = await recorder.stop();
      if (!mounted.current) return;
      const form = new FormData(); form.append("audio", recording, recording.type === "audio/webm" ? "voice.webm" : "voice.wav"); form.append("purpose", "dictation");
      const response = await fetch("/api/interview/transcribe", { method: "POST", body: form, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "转写失败");
      if (mounted.current) onText(result.transcript);
    } catch (error) { if (mounted.current) toast.error(error instanceof Error ? error.message : "转写失败，请重试"); }
    finally { clearTimeout(timeout); busy.current = false; if (mounted.current) setState("idle"); }
  }
  useEffect(() => { if (seconds >= 120 && state === "recording") void stop(); });
  async function click() {
    if (state === "recording") return stop();
    if (busy.current || disabled) return;
    busy.current = true;
    try { const recorder = await startRecording({ preferCompressed: true }); if (!mounted.current) { recorder.cancel(); return; } active.current = recorder; setSeconds(0); setState("recording"); }
    catch (error) { toast.error(error instanceof MicAccessDeniedError ? "请在系统隐私设置中允许麦克风访问" : "无法打开麦克风，请检查权限或设备"); }
    finally { busy.current = false; }
  }
  return <Button type="button" variant={state === "recording" ? "destructive" : "outline"} disabled={state === "transcribing" || (disabled && state !== "recording")} onClick={click} title="录音会发送至你配置的 Gemini 转写；文字进入草稿，不自动发送" aria-label="语音输入">{state === "recording" ? <><Square className="size-4" />{seconds}s</> : state === "transcribing" ? `转写中 ${seconds}s` : <Mic className="size-4" />}</Button>;
}
