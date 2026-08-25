"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageSquare, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  deleteInterviewSession,
  renameInterviewSession,
} from "@/lib/actions/interview-session";

export type SessionRow = {
  id: string;
  label: string;
  resumeName: string;
  status: "ACTIVE" | "ENDED";
};

export function MockInterviewSessionList({ sessions }: { sessions: SessionRow[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">历史记录</p>
      {sessions.map((s) => (
        <SessionRowItem key={s.id} session={s} />
      ))}
    </div>
  );
}

function SessionRowItem({ session }: { session: SessionRow }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.label);
  const [busy, setBusy] = useState(false);

  async function handleRename() {
    setBusy(true);
    try {
      const res = await renameInterviewSession(session.id, name);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("已改名");
      setRenaming(false);
    } finally {
      setBusy(false);
    }
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-2 rounded-md border p-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="h-8"
          autoFocus
        />
        <Button size="icon" className="size-8 shrink-0" disabled={busy} onClick={handleRename}>
          <Check className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          onClick={() => {
            setName(session.label);
            setRenaming(false);
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-2 rounded-md border p-2 text-sm hover:bg-muted">
      <Link href={`/mock-interview/${session.id}`} className="flex min-w-0 flex-1 items-center gap-2">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {session.label} · {session.resumeName}
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        <Badge variant={session.status === "ENDED" ? "secondary" : "outline"}>
          {session.status === "ENDED" ? "已结束" : "进行中"}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setRenaming(true)}
        >
          <Pencil className="size-3.5" />
        </Button>
        <ConfirmDeleteButton
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              删除
            </Button>
          }
          title={`删除「${session.label}」这场模拟面试？`}
          onConfirm={async () => {
            const res = await deleteInterviewSession(session.id);
            if (!res.ok) toast.error(res.message);
            else toast.success("已删除");
          }}
        />
      </div>
    </div>
  );
}
