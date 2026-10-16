"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SETTINGS_ANCHORS } from "@/lib/settings-tabs";

/** An old `/settings#mail-accounts` link opens the group that card is in now. */
export function SettingsHashRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    const tab = SETTINGS_ANCHORS[anchor];
    if (tab && params.get("tab") !== tab) router.replace(`/settings?tab=${tab}#${anchor}`);
  }, [params, router]);
  return null;
}
