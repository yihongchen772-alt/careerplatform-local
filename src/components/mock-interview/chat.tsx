"use client";

import { useState } from "react";
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
      const res = await sendInterviewMessage(sessionId, content);
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
            placeholder="打字回答..."
            rows={4}
            disabled={sending}
          />
          <div className="flex gap-2">
            <Button onClick={handleSend} disabled={sending || !input.trim()}>
              {sending ? "发送中..." : "发送"}
            </Button>
            <Button variant="outline" onClick={handleEnd} disabled={ending}>
              {ending ? "生成反馈中..." : "结束面试"}
            </Button>
          </div>
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
