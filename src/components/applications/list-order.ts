"use client";

import { useSyncExternalStore } from "react";

/**
 * The order 投递记录 last showed (its filter, search and sort), so a 投递's
 * page can step to the previous / next one in that same order and go back
 * to that same list.
 */
const KEY = "careerplatform.applications.order";

export type ListOrder = { ids: string[]; href: string; label: string };

export function rememberListOrder(order: ListOrder): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Private mode or storage off: the pager falls back to the default order.
  }
}

export function readListOrder(): ListOrder | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ListOrder>;
    if (!Array.isArray(value.ids) || typeof value.href !== "string" || !value.href.startsWith("/applications")) return null;
    return { ids: value.ids.filter((id): id is string => typeof id === "string"), href: value.href, label: typeof value.label === "string" ? value.label : "" };
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

/** The remembered order, read after hydration (the server has none). */
export function useListOrder(): ListOrder | null {
  const raw = useSyncExternalStore(subscribe, () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  }, () => null);
  if (!raw) return null;
  return readListOrder();
}
