/**
 * Server Actions can't report failures by throwing: in production Next.js
 * replaces a thrown error's message with an opaque digest (surfacing as the
 * minified React #441 "error occurred in the Server Components render"), so
 * every carefully written message reaches the user as a generic 500. It only
 * looks like it works in dev, where the real message is passed through.
 *
 * So actions that can fail for reasons the user can act on return a result
 * instead of throwing.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/**
 * Errors whose message is written for the user and is safe to show them.
 * Anything else (Prisma failures, bugs) is reported generically so internals
 * don't leak.
 */
export class UserFacingError extends Error {}

/** Runs `fn`, converting a UserFacingError into a failed result. */
export async function toActionResult<T>(
  fn: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof UserFacingError) {
      return { ok: false, message: err.message };
    }
    // Nothing logged these before, which is why the Vercel logs showed only
    // request lines and no cause when the AI calls started failing.
    console.error("[action]", err);
    return { ok: false, message: "操作失败，请稍后重试" };
  }
}
