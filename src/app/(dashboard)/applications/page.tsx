import { db } from "@/lib/db";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getAppSettings } from "@/lib/actions/app-settings";
import { AddApplicationDialog } from "@/components/applications/add-application-dialog";
import { ApplicationsView } from "@/components/applications/applications-view";
import { PortalSyncButton } from "@/components/applications/portal-sync-button";

export default async function ApplicationsPage() {
  const user = await requireUser();

  const [applications, resumeVersions, portals, settings] = await Promise.all([
    db.application.findMany({
      where: { userId: user.id },
      include: {
        company: true,
        // Only the entry matching the application's current stage is still
        // relevant to "what's next" — earlier stages' deadlines are history.
        // Deliberately NOT `orderBy: enteredAt desc, take: 1`: the very
        // first history row (APPLIED) stores enteredAt as a date-only value
        // parsed at UTC midnight, while every later row stores the real
        // instant of the update — for a same-day application from UTC+8,
        // that date-only midnight can sort *after* a same-day real
        // timestamp, so "latest by enteredAt" can silently pick the wrong
        // row. Matching on stage directly sidesteps the comparison.
        stageHistory: {
          select: { stage: true, enteredAt: true, nextDeadline: true, nextDeadlineEnd: true },
        },
      },
      orderBy: { appliedDate: "desc" },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: "desc" },
    }),
    db.applicationPortal.findMany({
      select: { id: true, companyId: true, label: true, lastCheckedAt: true, lastSuccessfulAt: true, lastError: true, company: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getAppSettings(),
  ]);

  const portalCompanies = new Set(portals.map((portal) => portal.companyId));
  const unassigned = applications.filter((app) => !app.portalId && !["REJECTED", "ACCEPTED", "DECLINED"].includes(app.currentStage) && portalCompanies.has(app.companyId));
  const autoSyncEnabled = settings.backgroundReminders && (settings.applicationSyncIntervalHours ?? 0) > 0;

  const defaultResumeVersionId =
    resumeVersions.find((r) => r.isDefault)?.id ?? null;

  return (
    <div className="mx-auto max-w-[110rem] space-y-7">
      <div className="relative overflow-hidden rounded-[1.8rem] border border-border/65 bg-card/75 px-5 py-6 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-7 sm:py-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
              <span className="size-1.5 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
              APPLICATION SPACE
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">投递记录</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">从发出申请到收到 Offer，把每一次进展收在同一个清晰的工作台。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <PortalSyncButton configuredCount={portals.length} />
          <AddApplicationDialog
            resumeVersions={resumeVersions}
            defaultResumeVersionId={defaultResumeVersionId}
          />
          </div>
        </div>
      </div>

      {portals.length > 0 && <section className="rounded-[1.35rem] border border-border/65 bg-card/65 p-4 text-xs shadow-sm sm:p-5" aria-label="官网进度同步状态">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-sm font-semibold">官网进度同步</h2><p className="mt-1 text-muted-foreground">{autoSyncEnabled ? `自动检查：每 ${settings.applicationSyncIntervalHours} 小时（设置变更重启 App 后生效）` : "自动检查未开启，可点上方按钮手动同步"}</p></div>
          <Link href="/settings" className="font-medium text-primary hover:underline">同步设置</Link>
        </div>
        {unassigned.length > 0 && <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 text-amber-700 dark:text-amber-300">{unassigned.length} 条投递尚未指定进度页，不会自动同步：{unassigned.slice(0, 3).map((app, index) => <span key={app.id}>{index > 0 ? "、" : ""}<Link href={`/applications/${app.id}`} className="underline underline-offset-2">{app.company.name} · {app.title}</Link></span>)}{unassigned.length > 3 ? "等" : ""}</p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{portals.map((portal) => <div key={portal.id} className="rounded-xl border border-border/55 bg-background/45 px-3 py-2.5">
          <p className="font-medium">{portal.company.name}{portal.label ? ` · ${portal.label}` : ""}</p>
          <p className="mt-1 text-muted-foreground">{portal.lastSuccessfulAt ? `上次成功：${portal.lastSuccessfulAt.toLocaleString("zh-CN")}` : "尚无成功同步记录"}</p>
          {portal.lastError && <p className="mt-1 text-destructive">上次失败：{portal.lastError}</p>}
        </div>)}</div>
      </section>}

      <ApplicationsView
        applications={applications.map((a) => {
          const currentEntry = a.stageHistory.find((h) => h.stage === a.currentStage && h.enteredAt.getTime() === a.currentStageDate.getTime())
            ?? a.stageHistory.filter((h) => h.stage === a.currentStage).sort((left, right) => right.enteredAt.getTime() - left.enteredAt.getTime())[0];
          return {
            ...a,
            appliedDate: a.appliedDate.toISOString(),
            currentStageDate: a.currentStageDate.toISOString(),
            nextDeadline: currentEntry?.nextDeadline?.toISOString() ?? null,
            nextDeadlineEnd: currentEntry?.nextDeadlineEnd?.toISOString() ?? null,
          };
        })}
      />
    </div>
  );
}
