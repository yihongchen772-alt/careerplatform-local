import { notFound } from "next/navigation";
import { PERSONALITY_TESTS } from "@/lib/personality-tests";
import { PersonalityTestRunner } from "@/components/personality/test-runner";
import { requireUser } from "@/lib/session";
import { BackLink } from "@/components/ui/back-link";
import { PageHero } from "@/components/layout/page-hero";
import { Brain } from "lucide-react";

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
      <PageHero title={test.title} description={test.subtitle} icon={Brain} back={<BackLink href="/personality" label="返回性格测试" />} />
      <PersonalityTestRunner testId={test.id} />
    </div>
  );
}
