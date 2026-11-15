"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, Radar, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Infobar } from "@/components/browser/infobar";
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
  hideApplied = false,
}: {
  bridge: DesktopBridge;
  url: string | null;
  title: string;
  loading: boolean;
  sites: KnownSite[];
  onPickPortalCompany: () => void;
  /** After submitting: 「你已投过」 warns before a repeat, it has nothing to say about the 投递 just made. */
  hideApplied?: boolean;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [candidatePage, setCandidatePage] = useState<{ url: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const key = siteKey(url) ?? url ?? "";
  const match = url ? matchKnownSite(sites, url, title) : null;

  useEffect(() => {
    if (!url || loading) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    const capture = async () => {
      try {
        const page = await bridge.capturePage();
        if (cancelled || page.url !== url) return false;
        const matched = looksLikeCandidateCenter(page.url, page.title, page.text);
        setCandidatePage(matched ? { url: page.url, text: page.text } : null);
        return matched;
      } catch {
        // A page that refuses scripts simply gets no hint.
        return false;
      }
    };
    // SPA candidate centers render their list asynchronously; retry once after the first probe if needed.
    const timer = window.setTimeout(async () => {
      const hit = await capture();
      if (!hit && !cancelled) {
        retryTimer = window.setTimeout(() => { void capture(); }, 2100);
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [bridge, url, loading]);

  const dismiss = (what: string) => setDismissed((current) => new Set(current).add(`${what}:${key}`));
  const isCandidateCenter = !!url && candidatePage?.url === url;
  const portalAlreadySet = !!match && !!siteKey(url) && match.portalKeys.includes(siteKey(url)!);
  const active = match?.applications.filter((application) => !application.terminal) ?? [];
  const showPortalSetup = isCandidateCenter && !portalAlreadySet && !dismissed.has(`portal:${key}`);
  const showPortalInlineSync = isCandidateCenter && portalAlreadySet && active.length > 0 && !dismissed.has(`portal-sync:${key}`);
  const showApplied = !!match && match.applications.length > 0 && !isCandidateCenter && !dismissed.has(`applied:${key}`);

  async function syncCurrentPortal() {
    if (!match || !url) return;
    setSaving(true);
    try {
      const live = await bridge.capturePage().catch(() => null);
      const pageText = (live && live.url === url ? live.text : candidatePage?.text || "").trim();
      if (!pageText) {
        toast.error("没读到当前页面内容，请等页面加载完再试");
        return;
      }
      const res = await fetch("/api/desktop-browser/sync-portal-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: match.companyId, url, pageText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "同步失败");
        return;
      }
      if (data.status === "skipped") {
        toast.success(`已设为「${data.companyName}」的进度页（当前暂无进行中投递可同步）`);
      } else {
        const parts: string[] = [];
        if (data.changes?.length) {
          parts.push(`推进 ${data.changes.length} 个阶段（${data.changes.map((c: { title: string; portalStatus: string }) => `${c.title} → ${c.portalStatus}`).join("、").slice(0, 60)}）`);
        }
        if (data.review?.length) parts.push(`${data.review.length} 条待你确认`);
        if (data.matched?.length && !parts.length) parts.push(`已核对 ${data.matched.length} 条状态`);
        toast.success(parts.length ? `「${data.companyName}」${parts.join("，")}` : `已同步「${data.companyName}」进度页，暂未匹配到进行中岗位变化`);
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!showPortalSetup && !showPortalInlineSync && !showApplied) return null;
  return (
    <>
      {showPortalSetup && (
        <Infobar
          tone="info"
          icon={<Radar />}
          onClose={() => dismiss("portal")}
          actions={match ? (
            <Button type="button" size="xs" disabled={saving} onClick={syncCurrentPortal}>
              {saving ? "同步中…" : `设为${match.companyName}进度页并同步`}
            </Button>
          ) : (
            <Button type="button" size="xs" onClick={onPickPortalCompany}>
              选公司并设为进度页
            </Button>
          )}
        >
          这像是{match ? `「${match.companyName}」的` : ""}「我的投递」页面。设为进度页后会立刻识别当前状态，后续也会定期同步。
        </Infobar>
      )}
      {showPortalInlineSync && match && (
        <Infobar
          tone="info"
          icon={<RefreshCw className={saving ? "animate-spin" : undefined} />}
          onClose={() => dismiss("portal-sync")}
          actions={
            <Button type="button" size="xs" disabled={saving} onClick={syncCurrentPortal}>
              {saving ? "正在读取当前页…" : "立即同步当前页进度"}
            </Button>
          }
        >
          当前在「{match.companyName}」已登录的「我的投递」页面，可跳过重新登录直接从当前页面更新阶段。
        </Infobar>
      )}
      {showApplied && !hideApplied && match && (
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
