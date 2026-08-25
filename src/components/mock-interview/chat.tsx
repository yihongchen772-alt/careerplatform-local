"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  sendInterviewMessage,
  endInterviewSession,
  type InterviewMessageDTO,
} from "@/lib/actions/interview-session";
import type { InterviewFeedback } from "@/lib/validation";
import { startRecording, type Recorder } from "@/lib/audio-recorder";

export function MockInterviewChat({
  sessionId,
  initialMessages,
  initialStatus,
  initialFeedback,
}: {
  sessionId: string;
  initialMessages: InterviewMessageDTO[];
  initialStatus: "ACTIVE" | "ENDED";
  initialFeedback: InterviewFeedback | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(initialStatus);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  // Held from the transcription until the answer is actually sent, so the
  // delivery observation stays attached to the answer it came from even if
  // the user edits the transcript first.
  const deliveryRef = useRef<string | null>(null);

  // Elapsed-time counter while recording. Interviews reward brevity, and
  // without a visible timer people ramble far longer than they realize.
  useEffect(() => {
    if (!recorder) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recorder]);

  // Releasing the mic on unmount matters: navigating away mid-recording
  // otherwise leaves the OS recording indicator on until the app quits.
  useEffect(() => () => recorder?.cancel(), [recorder]);

  async function handleMic() {
    if (recorder) {
      const active = recorder;
      setRecorder(null);
      setTranscribing(true);
      try {
        const wav = await active.stop();
        const form = new FormData();
        form.append("audio", new File([wav], "answer.wav", { type: "audio/wav" }));
        const res = await fetch("/api/interview/transcribe", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? "转写失败，请重试");
          return;
        }
        // Into the box rather than straight out the door: transcription is
        // not perfect, and a wrong word in a recorded answer should be
        // fixable before the interviewer sees it.
        setInput((prev) => (prev ? `${prev}\n${json.transcript}` : json.transcript));
        deliveryRef.current = json.delivery ?? null;
        if (json.delivery) toast.info(json.delivery);
      } catch {
        toast.error("录音处理失败，请重试");
      } finally {
        setTranscribing(false);
      }
      return;
    }

    try {
      const started = await startRecording();
      setSeconds(0);
      setRecorder(started);
    } catch {
      toast.error("打不开麦克风——检查一下系统里有没有给这个 App 麦克风权限");
    }
  }

  async function handleSend() {
    if (!input.trim()) return;
    const content = input.trim();
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "USER", content },
    ]);
    setInput("");
    setSending(true);
    try {
      const res = await sendInterviewMessage(sessionId, content, deliveryRef.current);
      deliveryRef.current = null;
      if (res.ok) {
        setMessages((prev) => [...prev, ...res.data.messages]);
      } else {
        toast.error(res.message);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleEnd() {
    setEnding(true);
    try {
      const res = await endInterviewSession(sessionId);
      if (res.ok) {
        setFeedback(res.data);
        setStatus("ENDED");
        toast.success("面试已结束，看看反馈吧");
      } else {
        toast.error(res.message);
      }
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "ASSISTANT"
                  ? "rounded-lg bg-muted p-3 text-sm"
                  : "rounded-lg bg-primary/10 p-3 text-sm"
              }
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {m.role === "ASSISTANT" ? "面试官" : "我"}
              </p>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.deliveryNote && (
                <p className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
                  <Mic className="mt-0.5 size-3 shrink-0" />
                  {m.deliveryNote}
                </p>
              )}
            </div>
          ))}
          {sending && (
            <p className="text-xs text-muted-foreground">面试官正在思考...</p>
          )}
        </CardContent>
      </Card>

      {status === "ACTIVE" ? (
        <div className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="打字回答，或点下面的「说」直接开口答..."
            rows={4}
            disabled={sending}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSend} disabled={sending || !input.trim()}>
              {sending ? "发送中..." : "发送"}
            </Button>
            <Button
              type="button"
              variant={recorder ? "destructive" : "outline"}
              onClick={handleMic}
              disabled={sending || transcribing}
            >
              {transcribing ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  转写中...
                </>
              ) : recorder ? (
                <>
                  <Square className="mr-1.5 size-4" />
                  停止（{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}）
                </>
              ) : (
                <>
                  <Mic className="mr-1.5 size-4" />
                  说
                </>
              )}
            </Button>
            <Button variant="outline" onClick={handleEnd} disabled={ending || !!recorder}>
              {ending ? "生成反馈中..." : "结束面试"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {recorder
              ? "正在录音，说完点「停止」。真实面试一道题一般 1-2 分钟。"
              : "口头作答会连语速、流利度、口头禅一起评——这些打字看不出来。转写出来可以改完再发。需要 Gemini 的 Key。"}
          </p>
        </div>
      ) : (
        feedback && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold tabular-nums">
                  {feedback.overallScore}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <p className="text-sm">{feedback.summary}</p>
              {feedback.strengths.length > 0 && (
                <div>
                  <p className="text-sm font-medium">表现好的地方</p>
                  <ul className="list-inside list-disc text-sm text-muted-foreground">
                    {feedback.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {feedback.improvements.length > 0 && (
                <div>
                  <p className="text-sm font-medium">需要改进</p>
                  <ul className="list-inside list-disc text-sm text-muted-foreground">
                    {feedback.improvements.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
