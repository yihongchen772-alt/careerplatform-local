import { oceanTest } from "./ocean";
import { mbtiTest } from "./mbti";
import { discTest } from "./disc";
import { hollandTest } from "./holland";
import type { TestDefinition } from "./types";

export * from "./types";

export const PERSONALITY_TESTS: Record<TestDefinition["id"], TestDefinition> = {
  OCEAN: oceanTest,
  MBTI: mbtiTest,
  DISC: discTest,
  HOLLAND: hollandTest,
};

export const PERSONALITY_TEST_LIST = Object.values(PERSONALITY_TESTS);
