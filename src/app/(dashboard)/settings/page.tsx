import { requireUser } from "@/lib/session";
import { ProfileForm } from "@/components/settings/profile-form";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { ProxySettingsCard } from "@/components/settings/proxy-settings-card";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { EmailSettingsForm } from "@/components/settings/email-settings-form";
import { MailAccountsCard } from "@/components/settings/mail-accounts-card";
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
import { toMemoryView, type MemoryView } from "@/lib/application-memory";
import { parseApplicationProfile } from "@/lib/application-profile";
import { db } from "@/lib/db";
import packageInfo from "../../../../package.json";

export default async function SettingsPage() {
  const user = await requireUser();
  const [aiKeys, appSettings, mailAccounts, freshnessResult, resumeVersions, rememberedAnswers, autoBackup, extensionPairing, memories] = await Promise.all([
    getAiKeysOverview(user.id),
    getAppSettings(),
    listMailAccounts(user.id),
    getDataFreshness(),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
    db.autofillAnswer.findMany({
      where: { userId: user.id, confirmed: true },
      select: { id: true, questionLabel: true, answer: true, kind: true, contextKey: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    getAutoBackupSettings(),
    getExtensionPairing(),
    db.applicationMemory.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
  ]);
  const freshness = freshnessResult.ok ? freshnessResult.data : null;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">账号设置</h1>
      <div className="grid gap-6 md:grid-cols-2">
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
        <ApplicationProfileCard initial={parseApplicationProfile(user.applicationProfile)} resumeVersions={resumeVersions} />
        <ApplicationMemoryCard initial={memories.map(toMemoryView).filter((row): row is MemoryView => row !== null)} />
        <ExtensionCard initial={extensionPairing} />
        <AutofillMemoryCard initial={rememberedAnswers.map((answer) => ({ ...answer, updatedAt: answer.updatedAt.toISOString() }))} />
        <AppearanceForm />
        <AiSettingsForm keys={aiKeys} />
        <ProxySettingsCard initial={appSettings} />
        <EmailSettingsForm currentUser={user.smtpUser} schedule={{ enabled: user.emailReminderEnabled, time: user.emailReminderTime, timeZone: user.emailReminderTimeZone, lastError: user.emailReminderLastError }} />
        <MailAccountsCard accounts={mailAccounts} />
        <BackgroundReminderCard initial={appSettings} />
        <BackupCard initialFreshness={freshness} />
        <AutoBackupCard initial={autoBackup} />
        <UpdateCard currentVersion={packageInfo.version} />
      </div>
    </div>
  );
}
