"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { MAX_MEMORIES } from "@/lib/agent/tools";

export type AgentState = {
  plan: string;
  planAt: string | null;
  memories: { id: string; content: string; createdAt: string }[];
};

/** 小欧's plan and long-term memory, for its 计划 / 记忆 tabs. */
export async function getAgentState(): Promise<ActionResult<AgentState>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const [row, memories] = await Promise.all([
      db.user.findUnique({ where: { id: user.id }, select: { agentPlan: true, agentPlanAt: true } }),
      db.agentMemory.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      plan: row?.agentPlan ?? "",
      planAt: row?.agentPlanAt?.toISOString() ?? null,
      memories: memories.map((memory) => ({ id: memory.id, content: memory.content, createdAt: memory.createdAt.toISOString() })),
    };
  });
}

/** The user's own edit of the plan; 小欧 keeps building on it. */
export async function saveAgentPlan(plan: string): Promise<ActionResult<{ planAt: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const text = plan.trim().slice(0, 6000);
    const at = new Date();
    await db.user.update({ where: { id: user.id }, data: { agentPlan: text || null, agentPlanAt: text ? at : null } });
    return { planAt: at.toISOString() };
  });
}

export async function addAgentMemory(content: string): Promise<ActionResult<{ id: string; content: string; createdAt: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const text = content.trim().slice(0, 300);
    if (!text) throw new UserFacingError("写点要小欧记住的");
    if ((await db.agentMemory.count({ where: { userId: user.id } })) >= MAX_MEMORIES) throw new UserFacingError(`最多记 ${MAX_MEMORIES} 条，先删掉过时的`);
    const memory = await db.agentMemory.create({ data: { userId: user.id, content: text } });
    return { id: memory.id, content: memory.content, createdAt: memory.createdAt.toISOString() };
  });
}

export async function deleteAgentMemory(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.agentMemory.deleteMany({ where: { id, userId: user.id } });
    return null;
  });
}
