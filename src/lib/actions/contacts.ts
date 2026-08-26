"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { contactSchema } from "@/lib/validation";

function revalidateContactPaths() {
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

export async function createContact(input: z.infer<typeof contactSchema>) {
  const user = await requireUser();
  const data = contactSchema.parse(input);

  await db.contact.create({
    data: {
      userId: user.id,
      name: data.name,
      role: data.role || undefined,
      companyName: data.companyName || undefined,
      contactInfo: data.contactInfo || undefined,
      note: data.note || undefined,
      nextFollowUpAt: data.nextFollowUpAt ?? undefined,
      positionId: data.positionId || undefined,
      applicationId: data.applicationId || undefined,
    },
  });

  revalidateContactPaths();
}

export async function updateContact(
  id: string,
  input: z.infer<typeof contactSchema>
) {
  const user = await requireUser();
  const existing = await db.contact.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) throw new Error("未找到该联系人");

  const data = contactSchema.parse(input);

  await db.contact.update({
    where: { id },
    data: {
      name: data.name,
      role: data.role || null,
      companyName: data.companyName || null,
      contactInfo: data.contactInfo || null,
      note: data.note || null,
      nextFollowUpAt: data.nextFollowUpAt ?? null,
      positionId: data.positionId || null,
      applicationId: data.applicationId || null,
    },
  });

  revalidateContactPaths();
}

/**
 * One-click "I just talked to them" — clears the follow-up reminder (it did
 * its job) and stamps when contact last happened, without opening the full
 * edit form for what's usually a same-day, no-other-changes action.
 */
export async function markContacted(id: string) {
  const user = await requireUser();
  await db.contact.updateMany({
    where: { id, userId: user.id },
    data: { lastContactedAt: new Date(), nextFollowUpAt: null },
  });
  revalidateContactPaths();
}

export async function deleteContact(id: string) {
  const user = await requireUser();
  await db.contact.deleteMany({ where: { id, userId: user.id } });
  revalidateContactPaths();
}
