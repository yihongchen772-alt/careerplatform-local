import { requireUser } from "@/lib/session";
import { listQuestionBanks } from "@/lib/actions/question-banks";
import { QuestionBanksView } from "@/components/question-banks/question-banks-view";

export default async function QuestionBanksPage() {
  const user = await requireUser();
  const banks = await listQuestionBanks(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">题库</h1>
        <p className="text-sm text-muted-foreground">
          可以导入导出的面试题集合，和某一条投递无关，换公司照样能复用
        </p>
      </div>
      <QuestionBanksView banks={banks} />
    </div>
  );
}
