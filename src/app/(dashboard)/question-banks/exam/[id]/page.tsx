import { notFound } from "next/navigation";
import { getExamSession } from "@/lib/actions/exam";
import { ExamRunner } from "@/components/question-banks/exam-runner";
import { BackLink } from "@/components/ui/back-link";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getExamSession(id);
  if (!res.ok) notFound();

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/question-banks" label="返回题库" />
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {res.data.status === "ENDED" ? "考试结果" : "模拟考试"}
        </h1>
        <p className="text-sm text-muted-foreground">{res.data.bankName}</p>
      </div>
      <ExamRunner exam={res.data} />
    </div>
  );
}
