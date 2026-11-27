import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const profileId = process.env.CAREERPLATFORM_PROFILE_ID || "default";
  const profileName = process.env.CAREERPLATFORM_PROFILE_NAME || "我的档案";
  const realName = user.name && user.name !== "我" && user.name !== "me@local" ? user.name.trim() : null;
  const displayName =
    realName && !profileName.includes(realName) ? `${profileName} (${realName})` : profileName;

  return NextResponse.json({
    activeProfileId: profileId,
    profileName,
    userRealName: realName,
    displayName,
    isDefault: profileId === "default",
    browserPartition: process.env.CAREERPLATFORM_BROWSER_PARTITION || "persist:job-application-browser",
  });
}
