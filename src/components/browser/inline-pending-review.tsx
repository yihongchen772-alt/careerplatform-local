"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, ExternalLink, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  acceptPendingApplicationChange,
  acceptPendingIntoProfile,
  ignorePendingApplicationChange,
  ignorePendingApplicationChanges,
} from "@/lib/actions/pending-application-change";
import {
  MEMORY_CATEGORIES,
  normalizeMemoryText,
  sameMemoryEntity,
  type MemoryCapture,
  type MemoryView,
} from "@/lib/application-memory";
import { companySpecificQuestion } from "@/lib/autofill-answer-scope";
import type { PendingAnswer, PendingApplicationChangeView } from "@/lib/pending-application-change";

type CompactAnswer = {
  id: string;
  questionLabel: string;
  answer: string;
  kind: string;
  contextKey: string | null;
  updatedAt: string;
};

type PendingPayload = {
  total: number;
  items: PendingApplicationChangeView[];
  sources: Record<string, string>;
  currentMemories: MemoryView[];
  currentAnswers: CompactAnswer[];
  profileValues: Record<string, string>;
  defaultResumeName?: string | null;
};

const VERDICT_STYLE: Record<string, string> = {
  add_new: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  upgrade_existing: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  conflict_review: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  company_specific: "bg-muted text-muted-foreground",
};

function hostTitle(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "网申页面";
  }
}

function previewText(row: PendingApplicationChangeView) {
  if (row.kind === "answer") return (row.payload as PendingAnswer).answer;
  const content = (row.payload as MemoryCapture).content;
  return [content.role || content.major || content.level, [content.start || content.date, content.end].filter(Boolean).join(" – "), content.description || content.responsibilities || content.text]
    .filter(Boolean)
    .join(" · ");
}

export function InlinePendingReview({
  active,
  refreshToken = 0,
  onCountChange,
  onOpenFullPage,
}: {
  active: boolean;
  refreshToken?: number;
  onCountChange?: (count: number) => void;
  onOpenFullPage?: () => void;
}) {
  const [data, setData] = useState<PendingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [answerEdits, setAnswerEdits] = useState<Record<string, string>>({});
  const [scopeChoice, setScopeChoice] = useState<Record<string, "local" | "global">>({});

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/desktop-browser/pending-changes", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as PendingPayload;
      setData(payload);
      onCountChange?.(payload.total);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void fetch("/api/desktop-browser/pending-changes", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<PendingPayload>) : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        setData(payload);
        onCountChange?.(payload.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, refreshToken, onCountChange]);

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        加载待核对内容…
      </div>
    );
  }

  const rows = data?.items ?? [];
  const memories = data?.currentMemories ?? [];
  const answers = data?.currentAnswers ?? [];
  const profileValues = data?.profileValues ?? {};
  const sources = data?.sources ?? {};

  const rowKey = (row: PendingApplicationChangeView) => `${row.id}:${row.revision}`;
  const scopeFor = (row: PendingApplicationChangeView) =>
    scopeChoice[rowKey(row)] ||
    (row.kind === "answer" && (row.payload as PendingAnswer).kind === "essay" && companySpecificQuestion((row.payload as PendingAnswer).questionLabel)
      ? "local"
      : "global");

  function findTargetMemory(row: PendingApplicationChangeView) {
    if (row.kind !== "record") return undefined;
    const rec = row.payload as MemoryCapture;
    const matches = memories.filter((m) => m.category === rec.category && sameMemoryEntity(rec.category, m.content, rec.content));
    return matches.length === 1 ? matches[0] : undefined;
  }

  function findExistingAnswer(row: PendingApplicationChangeView) {
    if (row.kind !== "answer") return undefined;
    const ans = row.payload as PendingAnswer;
    const ctx = scopeFor(row) === "global" ? null : row.contextKey;
    return answers.find(
      (a) => a.contextKey === ctx && a.kind === ans.kind && normalizeMemoryText(a.questionLabel) === normalizeMemoryText(ans.questionLabel)
    );
  }

  function removeRows(keys: string[]) {
    setData((cur) => {
      if (!cur) return cur;
      const next = cur.items.filter((item) => !keys.includes(rowKey(item)));
      onCountChange?.(next.length);
      return { ...cur, items: next, total: next.length };
    });
  }

  async function accept(
    row: PendingApplicationChangeView,
    mode: "default" | "profile" | "custom_field" | "resume_template" = "default"
  ) {
    setBusyId(row.id);
    try {
      const target = findTargetMemory(row);
      const saved = findExistingAnswer(row);
      const res = await acceptPendingApplicationChange(row.id, {
        revision: row.revision,
        shareAcrossCompanies: scopeFor(row) === "global",
        recordPreference: "version",
        target: target ? { id: target.id, revision: target.revision } : null,
        expectedAnswer: saved ? { id: saved.id, updatedAt: saved.updatedAt } : null,
        answer: row.kind === "answer" ? answerEdits[rowKey(row)] : undefined,
        enableAutomatic: true,
        toProfile: mode === "profile",
        toCustomField: mode === "custom_field",
        toResumeTemplate: mode === "resume_template",
      });
      if (!res.ok) return void toast.error(res.message);
      removeRows([rowKey(row)]);
      toast.success(
        mode === "resume_template"
          ? `已同步更新网申资料与简历模板${data?.defaultResumeName ? `（${data.defaultResumeName}）` : ""}`
          : mode === "custom_field"
            ? `已存为自定义栏位「${row.label}」，后续网申自动填入`
            : mode === "profile"
              ? `已记进网申资料「${row.profileField?.label}」`
              : row.kind === "record"
                ? "已加入经历库"
                : "已记住，下次遇到会复用"
      );
    } finally {
      setBusyId("");
    }
  }

  async function ignore(row: PendingApplicationChangeView) {
    setBusyId(row.id);
    try {
      const res = await ignorePendingApplicationChange(row.id, row.revision);
      if (!res.ok) return void toast.error(res.message);
      removeRows([rowKey(row)]);
    } finally {
      setBusyId("");
    }
  }

  const profileBatch = rows.filter(
    (r) => r.profileField && !["preferredCities", "targetRole"].includes(r.profileField.key) && !profileValues[r.profileField.key]?.trim()
  );

  async function acceptAllProfile() {
    if (!profileBatch.length) return;
    setBusyId("all");
    try {
      const seen = new Set<string>();
      const picked = [...profileBatch]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((r) => !seen.has(r.profileField!.key) && seen.add(r.profileField!.key));
      const res = await acceptPendingIntoProfile(picked.map((r) => ({ id: r.id, revision: r.revision })));
      if (!res.ok) return void toast.error(res.message);
      removeRows(picked.map(rowKey));
      toast.success(`已记进网申资料 ${res.data.saved} 项`);
    } finally {
      setBusyId("");
    }
  }

  async function ignoreAll() {
    if (!rows.length) return;
    setBusyId("all");
    try {
      const res = await ignorePendingApplicationChanges(rows.map((r) => ({ id: r.id, revision: r.revision })));
      if (!res.ok) return void toast.error(res.message);
      removeRows(rows.map(rowKey));
      toast.success(`已忽略 ${res.data.ignored} 条`);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">手写或新填的回答/经历，一键确认后下次直接复用</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="刷新待核对"
            disabled={loading}
            onClick={() => void handleRefresh()}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          {onOpenFullPage && (
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
              onClick={onOpenFullPage}
            >
              设置页<ExternalLink className="size-3" />
            </button>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {profileBatch.length > 0 && (
            <Button size="xs" variant="outline" disabled={!!busyId} onClick={() => void acceptAllProfile()}>
              <Check className="size-3" />全记进资料（{new Set(profileBatch.map((r) => r.profileField!.key)).size}）
            </Button>
          )}
          <Button size="xs" variant="ghost" disabled={!!busyId} onClick={() => void ignoreAll()}>
            全部忽略
          </Button>
        </div>
      )}

      {!rows.length ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-muted-foreground">
          <Inbox className="size-4" />
          当前没有待核对的内容
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const key = rowKey(row);
            const ans = row.kind === "answer" ? (row.payload as PendingAnswer) : null;
            const rec = row.kind === "record" ? (row.payload as MemoryCapture) : null;
            const sourceLabel = (row.contextKey && sources[row.contextKey]) || hostTitle(row.sourceUrl);
            const isOpen = expandedKey === key;
            return (
              <div key={key} className="rounded-lg border bg-background p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-medium">{row.label}</p>
                      {row.evaluation && (
                        <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${VERDICT_STYLE[row.evaluation.verdict] || "bg-muted text-muted-foreground"}`}>
                          {row.evaluation.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {sourceLabel} · {rec ? `新${MEMORY_CATEGORIES[rec.category]}` : row.profileField ? `网申资料 · ${row.profileField.label}` : ans?.kind === "essay" ? "问答" : "字段"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    disabled={!!busyId}
                    onClick={() => void ignore(row)}
                    title="忽略"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                {row.evaluation?.reason && (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground/90">{row.evaluation.reason}</p>
                )}

                {row.evaluation?.currentValue && (
                  <div className="mt-1.5 rounded bg-muted/50 px-2 py-1 text-[11px]">
                    <span className="text-muted-foreground">现有：</span>
                    <span className="line-clamp-2 text-muted-foreground line-through decoration-muted-foreground/50">{row.evaluation.currentValue}</span>
                  </div>
                )}

                <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-foreground/90">{previewText(row)}</p>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
                  {ans ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setExpandedKey(isOpen ? null : key)}
                    >
                      <ChevronRight className={`size-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />修改/范围
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {rec ? (
                      <>
                        <Button size="xs" variant="default" disabled={!!busyId} onClick={() => void accept(row, "resume_template")}>
                          <Check className="size-3" />更新资料与简历模板
                        </Button>
                        <Button size="xs" variant="outline" disabled={!!busyId} onClick={() => void accept(row, "default")}>
                          仅加经历库
                        </Button>
                      </>
                    ) : row.profileField ? (
                      <>
                        <Button size="xs" variant="default" disabled={!!busyId} onClick={() => void accept(row, "profile")}>
                          <Check className="size-3" />更新网申资料
                        </Button>
                        {row.profileField.key === "selfIntro" && (
                          <Button size="xs" variant="outline" disabled={!!busyId} onClick={() => void accept(row, "resume_template")}>
                            同步简历模板
                          </Button>
                        )}
                      </>
                    ) : row.evaluation?.recommendedTarget === "custom_field" ? (
                      <>
                        <Button size="xs" variant="default" disabled={!!busyId} onClick={() => void accept(row, "custom_field")}>
                          <Check className="size-3" />存为自定义栏位
                        </Button>
                        <Button size="xs" variant="outline" disabled={!!busyId} onClick={() => void accept(row, "default")}>
                          仅记住
                        </Button>
                      </>
                    ) : (
                      <Button size="xs" variant="outline" disabled={!!busyId} onClick={() => void accept(row, "default")}>
                        <Check className="size-3" />记住
                      </Button>
                    )}
                  </div>
                </div>

                {isOpen && ans && (
                  <div className="mt-2 space-y-2 border-t pt-2">
                    <textarea
                      className="w-full rounded border bg-transparent p-1.5 text-xs outline-none focus:border-ring"
                      rows={ans.kind === "essay" ? 3 : 1}
                      value={answerEdits[key] ?? ans.answer}
                      onChange={(e) => setAnswerEdits((cur) => ({ ...cur, [key]: e.target.value }))}
                    />
                    <div className="flex flex-wrap gap-3 text-[11px]">
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`inline-scope-${row.id}`}
                          checked={scopeFor(row) === "global"}
                          onChange={() => setScopeChoice((cur) => ({ ...cur, [key]: "global" }))}
                        />
                        通用复用
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`inline-scope-${row.id}`}
                          checked={scopeFor(row) === "local"}
                          onChange={() => setScopeChoice((cur) => ({ ...cur, [key]: "local" }))}
                        />
                        仅本岗位/公司
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
