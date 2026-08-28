import { db } from "@/lib/db";

// This is the offline single-user desktop build — there's no login, no
// cookies, no NextAuth session. Every page/action still calls requireUser()
// (unchanged from the web version, so the rest of the codebase didn't need
// touching), it just always resolves to the one local user, auto-created on
// first run.
export const LOCAL_USER_ID = "local-user";

export async function requireUser() {
  // upsert, not find-then-create: a page's layout and the page itself both
  // call requireUser() for the same request, and Next dev double-invokes
  // Server Components — two concurrent calls both seeing "not found" then
  // both calling create() hits the unique email constraint. upsert is the
  // atomic version of the same "get or make it" operation.
  return db.user.upsert({
    where: { id: LOCAL_USER_ID },
    update: {},
    create: {
      id: LOCAL_USER_ID,
      email: "me@local",
      name: "我",
    },
  });
}
