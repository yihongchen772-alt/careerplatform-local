"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PERSONALITY_TESTS } from "@/lib/personality-tests";
import type { LikertValue } from "@/lib/personality-tests";
import type { PersonalityTestType } from "@prisma/client";

/** Scoring is fixed, client-computable logic — this just persists the
 * already-computed result so the client and server never disagree. */
export async function savePersonalityTestResult(
  testType: PersonalityTestType,
  answers: Record<string, LikertValue>
) {
  const user = await requireUser();
  const test = PERSONALITY_TESTS[testType];
  if (!test) throw new Error("未知的测试类型");

  const scores = test.score(answers);
  const interpretation = test.interpret(scores);

  await db.personalityTestResult.create({
    data: {
      userId: user.id,
      testType,
      answers,
      scores,
      resultLabel: interpretation.label,
    },
  });

  revalidatePath("/personality");
}

export async function deletePersonalityTestResult(id: string) {
  const user = await requireUser();
  await db.personalityTestResult.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/personality");
}
