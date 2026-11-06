"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { companyDirectoryEntrySchema } from "@/lib/validation";
import { z } from "zod";

export async function addCompanyDirectoryEntry(
  input: z.infer<typeof companyDirectoryEntrySchema>
) {
  const user = await requireUser();
  const data = companyDirectoryEntrySchema.parse(input);

  const existing = await db.company.findUnique({ where: { name: data.name } });

  if (existing) {
    await db.company.update({
      where: { id: existing.id },
      data: {
        careerUrl: existing.careerUrl ?? data.careerUrl,
        sector: existing.sector ?? data.sector,
        industry: existing.industry ?? data.industry,
      },
    });
  } else {
    await db.company.create({
      data: {
        name: data.name,
        careerUrl: data.careerUrl,
        sector: data.sector,
        industry: data.industry,
        verified: false,
        addedByUserId: user.id,
      },
    });
  }

  revalidatePath("/companies");
}

/** Rename companies whose names carry leftovers. The old name stays as an alias, so mail signed with it still matches. */
export async function tidyCompanyNames(pairs: { from: string; to: string }[]) {
  await requireUser();
  const rows = z.array(z.object({ from: z.string().min(1).max(200), to: z.string().min(2).max(200) })).max(100).parse(pairs);
  const done: { from: string; to: string }[] = [];
  for (const pair of rows) {
    const company = await db.company.findUnique({ where: { name: pair.from }, select: { id: true } });
    if (!company || (await db.company.findUnique({ where: { name: pair.to }, select: { id: true } }))) continue;
    await db.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: { name: pair.to } });
      if (!(await tx.companyAlias.findUnique({ where: { alias: pair.from } }))) await tx.companyAlias.create({ data: { companyId: company.id, alias: pair.from } });
    });
    done.push(pair);
  }
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  return done;
}

export async function undoTidyCompanyNames(pairs: { from: string; to: string }[]) {
  await requireUser();
  const rows = z.array(z.object({ from: z.string().min(1).max(200), to: z.string().min(2).max(200) })).max(100).parse(pairs);
  for (const pair of rows) {
    const company = await db.company.findUnique({ where: { name: pair.to }, select: { id: true } });
    if (!company) continue;
    await db.$transaction(async (tx) => {
      await tx.companyAlias.deleteMany({ where: { companyId: company.id, alias: pair.from } });
      await tx.company.update({ where: { id: company.id }, data: { name: pair.from } });
    });
  }
  revalidatePath("/applications");
  revalidatePath("/dashboard");
}
