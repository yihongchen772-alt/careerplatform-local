"use client";

import { useEffect, useState } from "react";

/**
 * Something to look at while an AI call runs. The providers used here don't
 * stream through the structured-output path, so the honest thing to show is
 * elapsed time against what this kind of call usually takes, plus a hint
 * that changes as time passes — a bare spinner for 60 seconds reads as
 * "it's stuck". The bar is asymptotic: it approaches but never reaches full
 * before the real result arrives.
 */
export function AiProgress({
  active,
  expectedSeconds,
  stages,
  className,
}: {
  active: boolean;
  /** Typical duration — the bar reaches ~80% here. */
  expectedSeconds: number;
  /** Hints shown in order, each for expectedSeconds/stages.length seconds; the last one sticks. */
  stages: string[];
  className?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [active]);

  if (!active) return null;
  const ratio = 1 - Math.exp(-(elapsed / expectedSeconds) * 1.6);
  const stageIndex = Math.min(stages.length - 1, Math.floor((elapsed / expectedSeconds) * stages.length));
  const overdue = elapsed > expectedSeconds * 2;

  return (
    <div className={className ?? "space-y-1.5"} role="status">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{stages[stageIndex]}</span>
        <span className="tabular-nums">
          {Math.floor(elapsed)}s{overdue ? "，比平时慢，再等等" : ` · 通常 ${Math.round(expectedSeconds * 0.5)}-${Math.round(expectedSeconds * 1.5)} 秒`}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round(ratio * 92)}%` }} />
      </div>
    </div>
  );
}
