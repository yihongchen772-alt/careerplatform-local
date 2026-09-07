import { revalidatePath } from "next/cache";

/**
 * Shared by src/lib/actions/contacts.ts and src/lib/actions/assistant.ts's
 * add_contact action — kept in a plain module (not "use server", which
 * requires every export to be an async function) so both call sites revalidate
 * the same paths instead of hand-duplicating this list and risking drift.
 * /calendar reads Contact.nextFollowUpAt directly (see its page.tsx).
 */
export function revalidateContactPaths(): void {
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}
