import { requireUser } from "@/lib/session";
import { ProfileForm } from "@/components/settings/profile-form";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { EmailSettingsForm } from "@/components/settings/email-settings-form";
import { BackupCard } from "@/components/settings/backup-card";
import { BackgroundReminderCard } from "@/components/settings/background-reminder-card";
import { getAiKeysOverview } from "@/lib/actions/ai-keys";
import { getAppSettings } from "@/lib/actions/app-settings";

export default async function SettingsPage() {
  const user = await requireUser();
  const [aiKeys, appSettings] = await Promise.all([
    getAiKeysOverview(user.id),
    getAppSettings(),
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
        <EmailSettingsForm
          currentUser={user.smtpUser}
          inboxScanEnabled={user.inboxScanEnabled}
        />
        <BackgroundReminderCard initial={appSettings} />
        <BackupCard />
      </div>
    </div>
  );
}
