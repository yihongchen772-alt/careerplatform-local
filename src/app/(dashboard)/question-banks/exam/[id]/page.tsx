import { notFound } from "next/navigation";
import { getExamSession } from "@/lib/actions/exam";
import { ExamRunner } from "@/components/question-banks/exam-runner";

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
        <h1 className="text-3xl font-semibold tracking-tight">
          {res.data.status === "ENDED" ? "考试结果" : "模拟考试"}
        </h1>
        <p className="text-sm text-muted-foreground">{res.data.bankName}</p>
      </div>
      <ExamRunner exam={res.data} />
    </div>
  );
}
