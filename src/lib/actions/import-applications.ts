"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { resolveCompanyIds } from "@/lib/company-resolver";
import { IMPORT_STAGES, MAX_IMPORT_ROWS } from "@/lib/application-import";
import { terminationFields } from "@/lib/termination";

const rowSchema = z.object({
  companyName: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  city: z.string().trim().max(40).nullable(),
  appliedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  stage: z.enum(IMPORT_STAGES as [string, ...string[]]),
  statusText: z.string().max(60),
  source: z.string().trim().max(60).nullable(),
  note: z.string().trim().max(500).nullable(),
  applyUrl: z.string().trim().max(2000).regex(/^https?:\/\//i).nullable(),
});

function revalidate() {
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  revalidatePath("/insights");
}

/**
 * Puts the rows of the applicant's own tracking sheet in as 投递. A 投递 the
 * app already has (same company and 岗位) is left alone, so importing twice
 * adds nothing. Returns what was made so 撤销 can take exactly that back.
 */
export async function importApplications(
  input: unknown
): Promise<ActionResult<{ applicationIds: string[]; companyIds: string[]; skipped: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = z.array(rowSchema).min(1).max(MAX_IMPORT_ROWS).safeParse(input);
    if (!parsed.success) throw new UserFacingError("表格内容不对，请重新选择文件");
    const rows = parsed.data;

    const startedAt = new Date(Date.now() - 1000);
    const companyIdByName = await resolveCompanyIds(rows.map((row) => row.companyName), { addedByUserId: user.id });
    const companyIds = [...new Set(companyIdByName.values())];
    const known = await db.application.findMany({ where: { userId: user.id, companyId: { in: companyIds } }, select: { companyId: true, title: true } });
    const have = new Set(known.map((app) => `${app.companyId}|${app.title.trim().toLowerCase()}`));

    const now = new Date();
    const today = new Date(now.toISOString().slice(0, 10));
    const applicationIds: string[] = [];
    let skipped = 0;
    await db.$transaction(async (tx) => {
      for (const row of rows) {
        const companyId = companyIdByName.get(row.companyName.trim());
        if (!companyId) { skipped++; continue; }
        const key = `${companyId}|${row.title.trim().toLowerCase()}`;
        if (have.has(key)) { skipped++; continue; }
        have.add(key);
        const appliedDate = row.appliedDate ? new Date(row.appliedDate) : today;
        const later = row.stage !== "APPLIED";
        const application = await tx.application.create({
          data: {
            userId: user.id,
            companyId,
            title: row.title,
            city: row.city,
            source: row.source,
            applyUrl: row.applyUrl,
            appliedDate,
            currentStage: row.stage as never,
            // The sheet's status is as of today; only a plain 已投递 keeps the application day.
            currentStageDate: later ? now : appliedDate,
          },
        });
        await tx.stageHistory.create({ data: { applicationId: application.id, stage: "APPLIED", enteredAt: appliedDate, note: row.note } });
        if (later) {
          await tx.stageHistory.create({
            data: {
              applicationId: application.id,
              stage: row.stage as never,
              enteredAt: now,
              note: row.statusText ? `导入时表格里写的是「${row.statusText}」` : null,
              ...terminationFields(row.stage, "APPLIED"),
            },
          });
        }
        applicationIds.push(application.id);
      }
    });

    // Companies this import made (not ones that were already there): 撤销 may remove them again.
    const made = await db.company.findMany({ where: { id: { in: companyIds }, createdAt: { gte: startedAt } }, select: { id: true } });
    revalidate();
    return { applicationIds, companyIds: made.map((company) => company.id), skipped };
  });
}

/** 撤销 on an import: the 投递 it made, and the companies it made that nothing else uses. */
export async function undoImportApplications(applicationIds: string[], companyIds: string[]): Promise<ActionResult<{ removed: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const ids = z.array(z.string().min(1)).max(MAX_IMPORT_ROWS).parse(applicationIds);
    const companies = z.array(z.string().min(1)).max(MAX_IMPORT_ROWS).parse(companyIds);
    const removed = await db.application.deleteMany({ where: { id: { in: ids }, userId: user.id } });
    if (companies.length) {
      // A company that something else still points at stays; failing here only leaves an unused row.
      await db.company.deleteMany({ where: { id: { in: companies }, applications: { none: {} }, positions: { none: {} } } }).catch(() => undefined);
    }
    revalidate();
    return { removed: removed.count };
  });
}
