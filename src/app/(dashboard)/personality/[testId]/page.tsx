import { notFound } from "next/navigation";
import { PERSONALITY_TESTS } from "@/lib/personality-tests";
import { PersonalityTestRunner } from "@/components/personality/test-runner";
import { requireUser } from "@/lib/session";

export default async function PersonalityTestPage({
  params,
}: {
  params: Promise<{ testId: string }>;
}) {
  await requireUser();
  const { testId } = await params;
  const test = PERSONALITY_TESTS[testId.toUpperCase() as keyof typeof PERSONALITY_TESTS];
  if (!test) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{test.title}</h1>
        <p className="text-sm text-muted-foreground">{test.subtitle}</p>
      </div>
      <PersonalityTestRunner testId={test.id} />
    </div>
  );
}
