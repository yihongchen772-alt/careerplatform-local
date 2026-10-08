"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Infobar } from "@/components/browser/infobar";
import { setCompanyPortalUrl } from "@/lib/actions/application-sync";
import { looksLikeCandidateCenter, matchKnownSite, siteKey, type KnownSite } from "@/lib/site-key";

export type { KnownSite };
import type { DesktopBridge } from "@/types/desktop-bridge";

/**
 * Two hints above the page: "你已投过这家" (so the same role isn't applied to
 * twice) and, on a 我的投递 page, a one-click 设为进度页 so 进度同步 actually
 * gets set up for every company instead of the one or two done by hand.
 */
export function SiteBanner({
  bridge,
  url,
  title,
  loading,
  sites,
  onPickPortalCompany,
}: {
  bridge: DesktopBridge;
  url: string | null;
  title: string;
  loading: boolean;
  sites: KnownSite[];
  onPickPortalCompany: () => void;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const key = siteKey(url) ?? url ?? "";
  const match = url ? matchKnownSite(sites, url, title) : null;

  useEffect(() => {
    if (!url || loading) return;
    let cancelled = false;
    // SPA candidate centers render their list a moment after load.
    const timer = window.setTimeout(async () => {
      try {
        const page = await bridge.capturePage();
        if (cancelled || page.url !== url) return;
        setCandidateUrl(looksLikeCandidateCenter(page.url, page.title, page.text) ? page.url : null);
      } catch {
        // A page that refuses scripts simply gets no hint.
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bridge, url, loading]);

  const dismiss = (what: string) => setDismissed((current) => new Set(current).add(`${what}:${key}`));
  const isCandidateCenter = !!url && candidateUrl === url;
  const portalAlreadySet = !!match && !!siteKey(url) && match.portalKeys.includes(siteKey(url)!);
  const showPortal = isCandidateCenter && !portalAlreadySet && !dismissed.has(`portal:${key}`);
  const active = match?.applications.filter((application) => !application.terminal) ?? [];
  const showApplied = !!match && match.applications.length > 0 && !isCandidateCenter && !dismissed.has(`applied:${key}`);

  async function savePortal() {
    if (!match || !url) return;
    setSaving(true);
    try {
      const res = await setCompanyPortalUrl(match.companyId, url);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`已设为「${match.companyName}」的进度页，之后会自动同步投递阶段`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!showPortal && !showApplied) return null;
  return (
    <>
      {showPortal && (
        <Infobar
          tone="info"
          icon={<Radar />}
          onClose={() => dismiss("portal")}
          actions={match ? (
            <Button type="button" size="xs" disabled={saving} onClick={savePortal}>
              {saving ? "设置中…" : `设为${match.companyName}的进度页`}
            </Button>
          ) : (
            <Button type="button" size="xs" onClick={onPickPortalCompany}>
              选公司并设为进度页
            </Button>
          )}
        >
          这像是{match ? `「${match.companyName}」的` : ""}「我的投递」页面。设为进度页后，App 会定期读取它、自动推进投递阶段。
        </Infobar>
      )}
      {showApplied && match && (
        <Infobar tone="warning" icon={<History />} onClose={() => dismiss("applied")}>
          你已投过「{match.companyName}」：
          {match.applications.slice(0, 3).map((application, index) => (
            <span key={application.id}>
              {index > 0 && "、"}
              <Link href={`/applications/${application.id}`} className="underline underline-offset-2 hover:text-foreground">
                {application.title}
              </Link>
              （{application.stage}）
            </span>
          ))}
          {match.applications.length > 3 && ` 等 ${match.applications.length} 个岗位`}
          {active.length > 0 ? "。同一家公司通常限制投递数量，确认不是重复投递再提交。" : "。"}
        </Infobar>
      )}
    </>
  );
}
