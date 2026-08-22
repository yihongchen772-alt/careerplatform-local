"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { savePersonalityTestResult } from "@/lib/actions/personality-tests";
import { PERSONALITY_TESTS } from "@/lib/personality-tests";
import type { LikertValue, TestDefinition, TestInterpretation } from "@/lib/personality-tests";
import type { PersonalityTestType } from "@prisma/client";

export function PersonalityTestRunner({ testId }: { testId: TestDefinition["id"] }) {
  // Looked up client-side rather than passed in as a prop: `test` carries
  // score()/interpret() functions, and Server Components can't hand functions
  // across the boundary to a Client Component — only serializable data.
  const test = PERSONALITY_TESTS[testId];
  const [answers, setAnswers] = useState<Record<string, LikertValue>>({});
  const [result, setResult] = useState<TestInterpretation | null>(null);
  const [saving, setSaving] = useState(false);

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === test.items.length;

  function setAnswer(itemId: string, value: LikertValue) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  }

  async function handleSubmit() {
    if (!allAnswered) {
      toast.error("还有题目没答完");
      return;
    }
    const scores = test.score(answers);
    const interpretation = test.interpret(scores);
    setResult(interpretation);
    setSaving(true);
    try {
      await savePersonalityTestResult(test.id as PersonalityTestType, answers);
    } catch {
      toast.error("结果已算出，但保存失败（不影响你看结果）");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return <PersonalityResultView test={test} result={result} />;
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-10 rounded-md border bg-card/95 p-2 text-center text-sm text-muted-foreground backdrop-blur md:top-2">
        已答 {answeredCount} / {test.items.length}
      </div>

      <div className="space-y-3">
        {test.items.map((item, i) => (
          <Card key={item.id}>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm font-medium">
                {i + 1}. {item.text}
              </p>
              <LikertPicker
                value={answers[item.id]}
                onChange={(v) => setAnswer(item.id, v)}
                minLabel={test.scale.minLabel}
                maxLabel={test.scale.maxLabel}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Button onClick={handleSubmit} disabled={!allAnswered || saving} className="w-full">
        {saving ? "保存中..." : "查看结果"}
      </Button>
    </div>
  );
}

function LikertPicker({
  value,
  onChange,
  minLabel,
  maxLabel,
}: {
  value: LikertValue | undefined;
  onChange: (v: LikertValue) => void;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        {([1, 2, 3, 4, 5] as LikertValue[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-label={`${v} 分`}
            className={
              "flex size-9 items-center justify-center rounded-full border text-sm font-medium transition-colors " +
              (value === v
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted")
            }
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function PersonalityResultView({
  test,
  result,
}: {
  test: TestDefinition;
  result: TestInterpretation;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{test.title} · 结果</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-3xl font-semibold">{result.label}</div>
          <p className="text-sm text-muted-foreground">{result.summary}</p>

          <div className="space-y-3 pt-2">
            {result.details.map((d) => (
              <div key={d.dimension} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{d.label}</span>
                  <span className="tabular-nums text-muted-foreground">{d.score}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${Math.max(d.score, 2)}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">{d.text}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Link href="/personality" className="text-sm text-primary underline underline-offset-4">
        返回测试列表
      </Link>
    </div>
  );
}
