import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ProfileForm } from "@/components/settings/profile-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import type { AiProviderId } from "@/lib/ai-provider-labels";

export default async function SettingsPage() {
  const sessionUser = await requireUser();
  const user = await db.user.findUnique({ where: { id: sessionUser.id } });
  // Session cookie outliving the row (deleted account, restored DB) should send
  // the user to log in again, not render an error page.
  if (!user) redirect("/login");

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
        <ChangePasswordForm />
        <AppearanceForm />
        <AiSettingsForm
          currentProvider={user.aiProvider as AiProviderId | null}
          currentModel={user.aiModel}
        />
      </div>
    </div>
  );
}
