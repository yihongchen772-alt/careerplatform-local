import { requireUser } from "@/lib/session";
import { DashboardNav } from "@/components/dashboard/nav";
import { AssistantWidget } from "@/components/assistant/assistant-widget";

// Prisma reads aren't a Next.js "dynamic API", so without this every page in
// here would get prerendered once at `next build` time and served as frozen
// HTML from whatever the build machine's database happened to contain —
// wrong for a single-user local app where every page shows live personal
// data. `revalidatePath()` calls after mutations happen to paper over this
// during a single running session, but a fresh install/update would show
// build-time data until the first action touches each page.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-1">
      <DashboardNav userLabel={user.name ?? user.email ?? ""} />

      {/* Ambient background glow — two huge, softly blurred color blobs fixed
          to the viewport corners, well under the content in z-order and low
          enough opacity to read as depth rather than decoration. This is
          what actually gives a flat gray dashboard its "premium" feel;
          without it, the gradient tokens above only ever show up on small
          isolated elements (buttons, badges) and the page as a whole still
          reads flat. aria-hidden + pointer-events-none since it's purely
          decorative and must never intercept clicks meant for content
          underneath. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div
          className="absolute -top-40 right-[-8rem] size-[36rem] rounded-full opacity-30 blur-[90px] dark:opacity-40"
          style={{ background: "var(--glow-1)" }}
        />
        <div
          className="absolute top-1/3 -left-40 size-[32rem] rounded-full opacity-20 blur-[100px] dark:opacity-30"
          style={{ background: "var(--glow-2)" }}
        />
      </div>

      {/*
        min-w-0 (not overflow-x-hidden) keeps wide children from stretching the
        flex item: overflow-x:hidden forces overflow-y to compute to auto, which
        turns main into its own scroll box and breaks page scrolling on mobile.

        Top padding must track the fixed mobile bar's real height — 3.5rem plus
        the notch inset — or the notch area covers the first rows of content.

        relative z-10 lifts real content above the fixed glow layer, which
        otherwise sits at the DOM's natural stacking position (right below
        the nav, above nothing) and would paint over page content on some
        browsers' stacking-context resolution.
      */}
      <main className="relative z-10 min-w-0 flex-1 px-4 pb-16 pt-[calc(3.5rem+env(safe-area-inset-top)+1rem)] md:p-6 md:pb-16">
        {children}
      </main>
      <AssistantWidget />
    </div>
  );
}
