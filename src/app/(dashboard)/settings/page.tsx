import Link from "next/link";
import { requireUser } from "@/lib/session";
import { ProfileForm } from "@/components/settings/profile-form";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { AgentSettingsCard } from "@/components/settings/agent-settings-card";
import { ProxySettingsCard } from "@/components/settings/proxy-settings-card";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { EmailSettingsForm } from "@/components/settings/email-settings-form";
import { MailAccountsCard } from "@/components/settings/mail-accounts-card";
import { getScanHealth } from "@/lib/scan-health";
import { BackupCard } from "@/components/settings/backup-card";
import { AutoBackupCard } from "@/components/settings/auto-backup-card";
import { getAutoBackupSettings } from "@/lib/actions/auto-backup";
import { ExtensionCard } from "@/components/settings/extension-card";
import { getExtensionPairing } from "@/lib/actions/extension";
import { BackgroundReminderCard } from "@/components/settings/background-reminder-card";
import { getAiKeysOverview } from "@/lib/actions/ai-keys";
import { getAppSettings } from "@/lib/actions/app-settings";
import { listMailAccounts } from "@/lib/actions/mail-accounts";
import { getDataFreshness } from "@/lib/actions/backup";
import { UpdateCard } from "@/components/settings/update-card";
import { ApplicationProfileCard } from "@/components/settings/application-profile-card";
import { AutofillMemoryCard } from "@/components/settings/autofill-memory-card";
import { ApplicationMemoryCard } from "@/components/settings/application-memory-card";
import { PendingApplicationChangesCard } from "@/components/settings/pending-application-changes-card";
import { SettingsHashRedirect } from "@/components/settings/settings-hash-redirect";
import { loadVisiblePending, toPendingApplicationChangeView } from "@/lib/pending-application-change";
import { toMemoryView, type MemoryView } from "@/lib/application-memory";
import { parseApplicationProfile } from "@/lib/application-profile";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/settings-tabs";
import { db } from "@/lib/db";
import { PageHero } from "@/components/layout/page-hero";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import packageInfo from "../../../../package.json";

/**
 * Settings in groups, one at a time: each group loads only what it shows.
 * `?tab=` picks the group; old `#anchor` links are sent to theirs by
 * SettingsHashRedirect.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = (await searchParams).tab;
  const tab: SettingsTab = SETTINGS_TABS.some((item) => item.id === requested) ? (requested as SettingsTab) : "profile";
  const user = await requireUser();
  const current = SETTINGS_TABS.find((item) => item.id === tab)!;

  return (
    <div className="mx-auto max-w-5xl">
      <SettingsHashRedirect />
      <PageHero title="设置" icon={Settings} description="资料、AI、提醒和外观，一组一组来" />
      <div className="mt-6 flex flex-col gap-6 md:flex-row md:gap-10">
        <nav aria-label="设置分组" className="-mx-1 flex shrink-0 gap-1 overflow-x-auto md:mx-0 md:w-40 md:flex-col md:overflow-visible">
          {SETTINGS_TABS.map((item) => (
            <Link
              key={item.id}
              href={`/settings?tab=${item.id}`}
              aria-current={item.id === tab ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors",
                item.id === tab ? "bg-foreground/[0.06] font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-6">
          <p className="text-sm text-muted-foreground">{current.description}</p>
          {tab === "profile" && <ProfileSection user={user} />}
          {tab === "autofill" && <AutofillSection user={user} />}
          {tab === "memory" && <MemorySection userId={user.id} />}
          {tab === "ai" && <AiSection user={user} />}
          {tab === "mail" && <MailSection user={user} />}
          {tab === "appearance" && <AppearanceForm />}
          {tab === "data" && <DataSection />}
        </div>
      </div>
    </div>
  );
}

type User = Awaited<ReturnType<typeof requireUser>>;

function ProfileSection({ user }: { user: User }) {
  return (
    <ProfileForm
      initial={{
        name: user.name,
        phone: user.phone,
        contactEmail: user.contactEmail,
        gender: user.gender,
        birthDate: user.birthDate,
        school: user.school,
        targetTrack: user.targetTrack,
        graduationYear: user.graduationYear,
        skills: user.skills,
        preferredCities: user.preferredCities,
        expectedSalaryMin: user.expectedSalaryMin,
      }}
    />
  );
}

async function loadMemories(userId: string) {
  const [rememberedAnswers, memories] = await Promise.all([
    db.autofillAnswer.findMany({
      where: { userId, confirmed: true },
      select: { id: true, questionLabel: true, answer: true, kind: true, contextKey: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.applicationMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
  ]);
  return {
    memoryViews: memories.map(toMemoryView).filter((row): row is MemoryView => row !== null),
    answers: rememberedAnswers.map((answer) => ({ ...answer, updatedAt: answer.updatedAt.toISOString() })),
  };
}

async function AutofillSection({ user }: { user: User }) {
  const [resumeVersions, { memoryViews, answers }, pendingChanges] = await Promise.all([
    db.resumeVersion.findMany({ where: { userId: user.id }, select: { id: true, name: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
    loadMemories(user.id),
    loadVisiblePending(db, user.id),
  ]);
  // 待核对 groups by 网申: name the ones tied to a 候选岗位 after it.
  const jobIds = [...new Set(pendingChanges.map((row) => row.contextKey).filter((key): key is string => !!key?.startsWith("job:v1:")).map((key) => key.slice(7)))];
  const positions = jobIds.length ? await db.position.findMany({ where: { id: { in: jobIds }, userId: user.id }, select: { id: true, title: true, company: { select: { name: true } } } }) : [];
  const sources = Object.fromEntries(positions.map((position) => [`job:v1:${position.id}`, `${position.company.name} · ${position.title}`]));
  return (
    <>
      <PendingApplicationChangesCard initial={pendingChanges.map(toPendingApplicationChangeView)} sources={sources} currentMemories={memoryViews} currentAnswers={answers} currentFacts={{ 姓名: user.name, 手机: user.phone, 邮箱: user.contactEmail, 学校: user.school, 性别: user.gender, 出生日期: user.birthDate }} />
      <ApplicationProfileCard initial={parseApplicationProfile(user.applicationProfile)} resumeVersions={resumeVersions} />
    </>
  );
}

async function MemorySection({ userId }: { userId: string }) {
  const [{ memoryViews, answers }, extensionPairing] = await Promise.all([loadMemories(userId), getExtensionPairing()]);
  return (
    <>
      <ApplicationMemoryCard initial={memoryViews} />
      <AutofillMemoryCard initial={answers} />
      <ExtensionCard initial={extensionPairing} />
    </>
  );
}

async function AiSection({ user }: { user: User }) {
  const [aiKeys, appSettings] = await Promise.all([getAiKeysOverview(user.id), getAppSettings()]);
  return (
    <>
      <AiSettingsForm keys={aiKeys} />
      <AgentSettingsCard keys={aiKeys} initial={{ provider: user.agentAiProvider, model: user.agentAiModel, dailyBrief: user.agentDailyBrief, weeklyReview: user.agentWeeklyReview }} />
      <ProxySettingsCard initial={appSettings} />
    </>
  );
}

async function MailSection({ user }: { user: User }) {
  const [scanHealth, appSettings, mailAccounts] = await Promise.all([getScanHealth(user.id), getAppSettings(), listMailAccounts(user.id)]);
  return (
    <>
      <MailAccountsCard accounts={mailAccounts} health={{ failing: scanHealth.failing, error: scanHealth.error, lastOkAt: scanHealth.lastOkAt?.toISOString() ?? null }} />
      <BackgroundReminderCard initial={appSettings} autoApplyProgress={user.autoApplyProgress} />
      <EmailSettingsForm currentUser={user.smtpUser} schedule={{ enabled: user.emailReminderEnabled, time: user.emailReminderTime, timeZone: user.emailReminderTimeZone, lastError: user.emailReminderLastError }} />
    </>
  );
}

async function DataSection() {
  const [freshnessResult, autoBackup] = await Promise.all([getDataFreshness(), getAutoBackupSettings()]);
  return (
    <>
      <AutoBackupCard initial={autoBackup} />
      <BackupCard initialFreshness={freshnessResult.ok ? freshnessResult.data : null} />
      <UpdateCard currentVersion={packageInfo.version} />
    </>
  );
}
