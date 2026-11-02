import Link from "next/link";
import { Wrench } from "lucide-react";
import { PageHero } from "@/components/layout/page-hero";
import { TOOL_LINKS } from "@/lib/nav-tools";

/** 工具箱: the pages used now and then, out of the sidebar but one click away. */
export default function ToolsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="工具箱" icon={Wrench} description="不常用但用得上的工具都在这里" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TOOL_LINKS.map(({ href, label, icon: Icon, description }) => (
          <Link key={href} href={href} className="surface-card flex items-start gap-3 rounded-xl p-4 transition-colors hover:border-primary/40">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
            <span className="min-w-0">
              <span className="block font-medium">{label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
