import { requireUser } from "@/lib/session";
import { DashboardNav } from "@/components/dashboard/nav";

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
      {/*
        min-w-0 (not overflow-x-hidden) keeps wide children from stretching the
        flex item: overflow-x:hidden forces overflow-y to compute to auto, which
        turns main into its own scroll box and breaks page scrolling on mobile.

        Top padding must track the fixed mobile bar's real height — 3.5rem plus
        the notch inset — or the notch area covers the first rows of content.
      */}
      <main className="min-w-0 flex-1 px-4 pb-16 pt-[calc(3.5rem+env(safe-area-inset-top)+1rem)] md:p-6 md:pb-16">
        {children}
      </main>
    </div>
  );
}
