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
