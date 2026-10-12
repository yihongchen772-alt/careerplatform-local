import { db } from "@/lib/db";

/**
 * Deletes several 投递 of one user. As with a single delete, the history,
 * attachments and calendar copies go with them (cascade), and a source
 * position becomes applicable again. Shared by the batch action and the
 * page-close beacon, which has no server-action context.
 */
export async function deleteApplicationsFor(userId: string, ids: string[]): Promise<number> {
  const apps = await db.application.findMany({ where: { id: { in: ids }, userId }, select: { id: true, positionId: true } });
  await db.$transaction(async (tx) => {
    for (const app of apps) {
      await tx.application.delete({ where: { id: app.id } });
      if (app.positionId) await tx.position.updateMany({ where: { id: app.positionId, userId }, data: { status: "EVALUATING" } });
    }
  }, { timeout: 30000 });
  return apps.length;
}
