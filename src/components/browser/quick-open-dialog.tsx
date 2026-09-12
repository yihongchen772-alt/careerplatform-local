"use client";

import { useEffect, useState } from "react";
import { Building2, Clock, ListChecks, Radar } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { DesktopBridgeHistoryEntry } from "@/types/desktop-bridge";

export type QuickLinks = {
  /** 企业名录 entries that have a careers URL. */
  companies: { id: string; name: string; url: string }[];
  /** Candidate-pool positions with a JD link, active ones first. */
  positions: { id: string; label: string; url: string }[];
  /** Companies with a 进度同步 page set. */
  portals: { id: string; name: string; url: string }[];
};

/**
 * ⌘K-style launcher for the places a job seeker actually goes back to: the
 * careers sites saved in 企业名录, JD links from the candidate pool, each
 * company's "我的投递" page, and whatever was visited recently — so the
 * address bar is for new sites only. ⌘-click (or the "新标签页" hint) opens
 * in a new tab.
 */
export function QuickOpenDialog({
  open,
  onOpenChange,
  links,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: QuickLinks;
  onOpen: (url: string, inNewTab: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<DesktopBridgeHistoryEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    window.desktopBridge?.history().then(setHistory).catch(() => {});
  }, [open]);

  // Reset on close rather than open so the next opening (from a button or
  // ⌘K alike) always starts blank.
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };

  // cmdk's own filtering is by the `value` string, so pack every searchable
  // bit of text into it.
  const pick = (url: string) => (e?: { metaKey?: boolean; ctrlKey?: boolean }) =>
    onOpen(url, !!(e?.metaKey || e?.ctrlKey));

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} title="常用入口" description="企业官网、候选岗位、进度页、最近访问">
      <Command>
        <CommandInput placeholder="搜公司 / 岗位 / 网址…   按住 ⌘ 点击在新标签页打开" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>没有匹配的入口——直接在地址栏输入网址</CommandEmpty>
          {links.portals.length > 0 && (
            <CommandGroup heading="我的投递 / 进度页">
              {links.portals.map((p) => (
                <CommandItem key={`portal-${p.id}`} value={`portal ${p.name} ${p.url}`} onSelect={() => pick(p.url)()}>
                  <Radar />
                  <span className="truncate">{p.name} · 我的投递</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {links.positions.length > 0 && (
            <CommandGroup heading="候选岗位 JD">
              {links.positions.map((p) => (
                <CommandItem key={`pos-${p.id}`} value={`position ${p.label} ${p.url}`} onSelect={() => pick(p.url)()}>
                  <ListChecks />
                  <span className="truncate">{p.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {links.companies.length > 0 && (
            <CommandGroup heading="企业官网招聘页">
              {links.companies.map((c) => (
                <CommandItem key={`co-${c.id}`} value={`company ${c.name} ${c.url}`} onSelect={() => pick(c.url)()}>
                  <Building2 />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{hostOf(c.url)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {history.length > 0 && (
            <CommandGroup heading="最近访问">
              {history.slice(0, 15).map((h) => (
                <CommandItem key={`h-${h.url}`} value={`history ${h.title} ${h.url}`} onSelect={() => pick(h.url)()}>
                  <Clock />
                  <span className="truncate">{h.title || h.url}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{hostOf(h.url)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
