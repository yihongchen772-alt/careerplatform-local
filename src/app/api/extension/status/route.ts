import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { parseApplicationProfile } from "@/lib/application-profile";
import packageInfo from "../../../../../package.json";

// The extension's "connected?" check and the lists its popup offers.
export async function GET(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const user = await requireUser();
  const resumes = await db.resumeVersion.findMany({
    where: { userId: user.id, fileUrl: { not: null } },
    select: { id: true, name: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  const variants = parseApplicationProfile(user.applicationProfile).variants.map((v) => ({ id: v.id, name: v.name, resumeVersionId: v.resumeVersionId ?? null }));
  return NextResponse.json({ ok: true, appVersion: packageInfo.version, userName: user.name, resumes, variants });
}
