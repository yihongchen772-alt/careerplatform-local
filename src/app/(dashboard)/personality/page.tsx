import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PERSONALITY_TEST_LIST } from "@/lib/personality-tests";
import { PersonalityHistoryList } from "@/components/personality/history-list";
import { CareerFitCard } from "@/components/personality/career-fit-card";
import type { CareerFitAnalysis } from "@/lib/validation";

export default async function PersonalityPage() {
  const user = await requireUser();

  const [results, careerFit] = await Promise.all([
    db.personalityTestResult.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    db.careerFitAnalysis.findUnique({ where: { userId: user.id } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">性格 / 职业兴趣测试</h1>
        <p className="text-sm text-muted-foreground">
          自测参考版，基于公开的心理学理论结构自己撰写题目，不是官方量表——结果仅供了解自己的行为风格参考，别当成唯一依据
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PERSONALITY_TEST_LIST.map((test) => (
          <Card key={test.id}>
            <CardHeader>
              <CardTitle>{test.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{test.subtitle}</p>
              <p className="text-xs text-muted-foreground">{test.items.length} 题，约 {Math.ceil(test.items.length / 6)} 分钟</p>
              <Link
                href={`/personality/${test.id.toLowerCase()}`}
                className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                开始测试
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <CareerFitCard
        hasAnyResult={results.length > 0}
        initialResult={careerFit ? (careerFit.content as CareerFitAnalysis) : null}
      />

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>历史结果</CardTitle>
          </CardHeader>
          <CardContent>
            <PersonalityHistoryList
              results={results.map((r) => ({
                id: r.id,
                testType: r.testType,
                resultLabel: r.resultLabel,
                createdAt: r.createdAt.toISOString(),
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
