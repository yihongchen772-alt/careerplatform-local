"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { AI_PROVIDER_OPTIONS } from "@/lib/ai-provider-labels";
import { loadBriefState, writeBrief, type BriefKind, type BriefView } from "@/lib/agent/brief";

/**
 * Writes the brief that is owed (opening 总览), or rewrites it when asked
 * (`again`). Not owed and not asked: returns what is there.
 */
export async function generateBrief(kind: BriefKind, again = false): Promise<ActionResult<BriefView | null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (kind !== "daily" && kind !== "weekly") throw new UserFacingError("不支持的简报");
    const state = await loadBriefState(user.id);
    const current = kind === "daily" ? state.daily : state.weekly;
    if (!again && !(kind === "daily" ? state.dailyDue : state.weeklyDue)) return current;
    const brief = await writeBrief(user.id, kind);
    if (!brief) throw new UserFacingError("先在设置里配置一个 AI Key，小欧才能写简报");
    revalidatePath("/dashboard");
    return brief;
  });
}

const settingsSchema = z.object({
  provider: z.string().nullable(),
  model: z.string().trim().max(200).nullable(),
  dailyBrief: z.boolean(),
  weeklyReview: z.boolean(),
});

/** 小欧's own model (null: follow the default) and its two scheduled briefs. */
export async function updateAgentSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const data = settingsSchema.parse(input);
    if (data.provider && !AI_PROVIDER_OPTIONS.some((option) => option.id === data.provider)) throw new UserFacingError("不支持的服务商");
    if (data.provider && !(await db.aiKey.findUnique({ where: { userId_provider: { userId: user.id, provider: data.provider } } }))) throw new UserFacingError("先配置这个服务商的 Key");
    await db.user.update({
      where: { id: user.id },
      data: { agentAiProvider: data.provider, agentAiModel: data.provider ? data.model || null : null, agentDailyBrief: data.dailyBrief, agentWeeklyReview: data.weeklyReview },
    });
    revalidatePath("/settings");
    return null;
  });
}
