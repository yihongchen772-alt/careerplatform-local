import { requireUser } from "@/lib/session";
import { ProfileForm } from "@/components/settings/profile-form";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { ProxySettingsCard } from "@/components/settings/proxy-settings-card";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { EmailSettingsForm } from "@/components/settings/email-settings-form";
import { MailAccountsCard } from "@/components/settings/mail-accounts-card";
import { BackupCard } from "@/components/settings/backup-card";
import { BackgroundReminderCard } from "@/components/settings/background-reminder-card";
import { getAiKeysOverview } from "@/lib/actions/ai-keys";
import { getAppSettings } from "@/lib/actions/app-settings";
import { listMailAccounts } from "@/lib/actions/mail-accounts";

export default async function SettingsPage() {
  const user = await requireUser();
  const [aiKeys, appSettings, mailAccounts] = await Promise.all([
    getAiKeysOverview(user.id),
    getAppSettings(),
    listMailAccounts(user.id),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">账号设置</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <ProfileForm
          initial={{
            name: user.name,
            school: user.school,
            targetTrack: user.targetTrack,
            graduationYear: user.graduationYear,
            skills: user.skills,
            preferredCities: user.preferredCities,
            expectedSalaryMin: user.expectedSalaryMin,
          }}
        />
        <AppearanceForm />
        <AiSettingsForm keys={aiKeys} />
        <ProxySettingsCard initial={appSettings} />
        <EmailSettingsForm currentUser={user.smtpUser} />
        <MailAccountsCard accounts={mailAccounts} />
        <BackgroundReminderCard initial={appSettings} />
        <BackupCard />
      </div>
    </div>
  );
}
