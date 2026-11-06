"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const KEY = "careerplatform.leads.position";
type Saved = { search: string; scrollY: number; rowId: string | null };

function read(): Saved | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return value && typeof value.search === "string" ? { search: value.search, scrollY: Number(value.scrollY) || 0, rowId: typeof value.rowId === "string" ? value.rowId : null } : null;
  } catch {
    return null;
  }
}
function write(saved: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {}
}

/**
 * 秋招信息库 is left all the time for the 网申浏览器, and the sidebar's way back
 * has no filters in it. The list remembers its filters, page and scroll, and
 * comes back to them, with the row last opened marked. An address that names
 * filters (a notification, 「清除筛选」) is taken as asked.
 */
export function ListPositionKeeper() {
  const router = useRouter();
  const search = useSearchParams().toString();
  const arrived = useRef(false);

  useEffect(() => {
    const saved = read();
    if (!search && saved?.search) {
      router.replace(`/leads?${saved.search}`, { scroll: false });
      return;
    }
    if (arrived.current || saved?.search !== search) {
      // Another filter or page starts at its top.
      write({ search, scrollY: 0, rowId: null });
    } else {
      const row = saved.rowId ? document.querySelector<HTMLElement>(`[data-posting-id="${CSS.escape(saved.rowId)}"]`) : null;
      if (row) {
        row.scrollIntoView({ block: "center" });
        row.dataset.lastOpened = "true";
      } else {
        window.scrollTo(0, saved.scrollY);
      }
    }
    arrived.current = true;
  }, [search, router]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const saved = read();
        if (saved && saved.search === search) write({ ...saved, scrollY: window.scrollY });
      }, 150);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href^="/browser"]');
      const row = link?.closest<HTMLElement>("[data-posting-id]");
      if (!row) return;
      document.querySelectorAll<HTMLElement>('[data-last-opened="true"]').forEach((other) => { delete other.dataset.lastOpened; });
      row.dataset.lastOpened = "true";
      write({ search, scrollY: window.scrollY, rowId: row.dataset.postingId ?? null });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
    };
  }, [search]);

  return null;
}
