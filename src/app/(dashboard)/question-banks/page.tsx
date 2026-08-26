import { requireUser } from "@/lib/session";
import { listQuestionBanks } from "@/lib/actions/question-banks";
import { listExamSessions } from "@/lib/actions/exam";
import { QuestionBanksView } from "@/components/question-banks/question-banks-view";

export default async function QuestionBanksPage() {
  const user = await requireUser();
  const [banks, exams] = await Promise.all([
    listQuestionBanks(user.id),
    listExamSessions(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">题库</h1>
        <p className="text-sm text-muted-foreground">
          可以导入导出的面试题集合，和某一条投递无关，换公司照样能复用；分好模块后可以直接开一场模拟考试
        </p>
      </div>
      <QuestionBanksView banks={banks} exams={exams} />
    </div>
  );
}
