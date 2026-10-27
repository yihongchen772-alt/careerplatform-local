"use client";

import Link from "next/link";
import { useSyncExternalStore, useState } from "react";
import { Check, ChevronDown, Circle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type OnboardingStep = {
  key: string;
  title: string;
  hint: string;
  href: string;
  done: boolean;
};

const DISMISS_KEY = "careerplatform.onboarding.dismissed";

const noop = () => () => {};
function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Compact, expandable setup checklist. It stays available below the daily
 * workspace without taking over the first screen, and disappears when done
 * or when dismissed on this device.
 */
export function OnboardingCard({ steps, defaultOpen = false }: { steps: OnboardingStep[]; defaultOpen?: boolean }) {
  const dismissed = useSyncExternalStore(noop, readDismissed, () => false);
  const [hidden, setHidden] = useState(false);
  const remaining = steps.filter((s) => !s.done);
  if (dismissed || hidden || remaining.length === 0) return null;
  const doneCount = steps.length - remaining.length;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setHidden(true);
  }

  return (
    <Card className="surface-card relative overflow-hidden rounded-xl py-0">
      <details className="group" open={defaultOpen}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 pr-16 marker:hidden sm:pl-6 [&::-webkit-details-marker]:hidden">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold">完善你的工作台</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">{doneCount}/{steps.length}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">下一步：{remaining[0].title}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border/60 px-5 py-4 sm:px-6">
          <p className="mb-3 text-xs text-muted-foreground">完成这些设置后，网申填充和岗位管理会更顺手。</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className={`flex items-start gap-3 rounded-xl border border-border/60 p-3 text-sm transition-colors ${
                    s.done ? "bg-muted/30 text-muted-foreground" : "bg-background/35 hover:bg-muted/50"
                  }`}
                >
                  {s.done ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className={s.done ? "line-through" : "font-medium"}>{i + 1}. {s.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{s.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </details>
      <Button type="button" variant="ghost" size="icon" aria-label="不再显示" onClick={dismiss} className="absolute right-3 top-[1.125rem] size-8 text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </Button>
    </Card>
  );
}
