import { db } from "@/lib/db";
import { getUserAiConfig, getUserAiKey, type AiProviderId, type UserAiConfig } from "@/lib/ai-providers";

/**
 * The model 小欧 runs on: its own choice when set (a stronger model just for
 * the agent, while other features keep a cheaper default), else the default.
 * A choice whose provider Key has since been removed falls back too.
 */
export async function getAgentConfig(userId: string): Promise<UserAiConfig | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { agentAiProvider: true, agentAiModel: true } });
  if (user?.agentAiProvider) {
    const own = await getUserAiKey(userId, user.agentAiProvider as AiProviderId);
    if (own) return user.agentAiModel ? { ...own, model: user.agentAiModel } : own;
  }
  return getUserAiConfig(userId);
}
