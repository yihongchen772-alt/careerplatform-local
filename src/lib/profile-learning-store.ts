import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseApplicationProfile } from "@/lib/application-profile";
import { undoLearned } from "@/lib/profile-learning";

/** 撤销 for what the 网申浏览器 / 插件 wrote into 网申资料 from a page. */
export async function applyUndoLearned(userId: string, ids: string[]) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { applicationProfile: true, preferredCities: true } });
    const { profile, preferredCities, undone, kept } = undoLearned(parseApplicationProfile(user.applicationProfile), user, ids);
    await tx.user.update({ where: { id: userId }, data: { applicationProfile: profile as Prisma.InputJsonValue, ...(preferredCities !== undefined ? { preferredCities } : {}) } });
    return { undone, kept };
  });
}
