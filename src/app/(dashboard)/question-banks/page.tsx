import { requireUser } from "@/lib/session";
import { listQuestionBanks } from "@/lib/actions/question-banks";
import { listExamSessions, getWeakPointSummary } from "@/lib/actions/exam";
import { QuestionBanksView } from "@/components/question-banks/question-banks-view";
import { WeakPointsPanel } from "@/components/question-banks/weak-points-panel";
import { PageHero } from "@/components/layout/page-hero";
import { Library } from "lucide-react";

export default async function QuestionBanksPage() {
  const user = await requireUser();
  const [banks, exams, weakPoints] = await Promise.all([
    listQuestionBanks(user.id),
    listExamSessions(user.id),
    getWeakPointSummary(),
  ]);

  return (
    <div className="space-y-6">
      <PageHero title="题库" icon={Library} description="可以导入导出的面试题集合，和某一条投递无关，换公司照样能复用；分好模块后可以直接开一场模拟考试" />
      <WeakPointsPanel points={weakPoints} />
      <QuestionBanksView banks={banks} exams={exams} />
    </div>
  );
}
