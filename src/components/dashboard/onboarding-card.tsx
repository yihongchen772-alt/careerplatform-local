"use client";

import Link from "next/link";
import { useSyncExternalStore, useState } from "react";
import { Check, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
 * First-run checklist at the top of 总览. Every page in this app is empty
 * until the user has fed it something, and someone arriving from a 小红书
 * post has no idea which of the fifteen sidebar entries to click first —
 * this is the "do these four things" answer. Disappears on its own once
 * every step is done; can be dismissed early (per device, localStorage).
 */
export function OnboardingCard({ steps }: { steps: OnboardingStep[] }) {
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
    <Card className="border-primary/30">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>开始使用 · {doneCount}/{steps.length}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">按这个顺序把底子打好，后面的功能才有东西可用。</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="不再显示" onClick={dismiss}>
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  s.done ? "border-transparent bg-muted/40 text-muted-foreground" : "hover:bg-muted/40"
                }`}
              >
                {s.done ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className={s.done ? "line-through" : "font-medium"}>
                    {i + 1}. {s.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
