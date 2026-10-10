import { useState, useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * A per-device choice kept in localStorage (看板 or 列表, how a list is
 * sorted); the fallback whenever storage is unavailable or holds something else.
 */
export function useStoredChoice<T extends string>(key: string, choices: readonly T[], fallback: T): [T, (value: T) => void] {
  const stored = useSyncExternalStore(
    noop,
    () => {
      try {
        const value = localStorage.getItem(key);
        return value !== null && (choices as readonly string[]).includes(value) ? (value as T) : fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback
  );
  const [override, setOverride] = useState<T | null>(null);
  function choose(value: T) {
    setOverride(value);
    try { localStorage.setItem(key, value); } catch { /* per-device convenience only */ }
  }
  return [override ?? stored, choose];
}
