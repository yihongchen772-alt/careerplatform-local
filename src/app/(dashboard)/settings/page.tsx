import { requireUser } from "@/lib/session";
import { ProfileForm } from "@/components/settings/profile-form";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { EmailSettingsForm } from "@/components/settings/email-settings-form";
import { BackupCard } from "@/components/settings/backup-card";
import { getAiKeysOverview } from "@/lib/actions/ai-keys";

export default async function SettingsPage() {
  const user = await requireUser();
  const aiKeys = await getAiKeysOverview(user.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">账号设置</h1>
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
        <BackupCard />
      </div>
    </div>
  );
}
