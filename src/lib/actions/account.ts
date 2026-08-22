"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { updateProfileSchema } from "@/lib/validation";

export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const user = await requireUser();
  const data = updateProfileSchema.parse(input);

  await db.user.update({
    where: { id: user.id },
    data: {
      name: data.name,
      school: data.school,
      targetTrack: data.targetTrack,
      graduationYear: data.graduationYear,
      skills: data.skills,
      preferredCities: data.preferredCities,
      expectedSalaryMin: data.expectedSalaryMin,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/pool");
}
