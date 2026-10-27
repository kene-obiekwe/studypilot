import { useMemo, useSyncExternalStore } from "react";

/**
 * Which course sections on /strategies the viewer has collapsed, remembered in localStorage.
 * Stored as a JSON array of course ids. Course ids are database keys, unique across users, so one
 * key per browser still keeps each viewer's choices apart. Every section starts expanded: the page
 * logs each strategy it fetches as shown, so it shouldn't hide them before the viewer asks.
 *
 * Storage can be unavailable (private windows, blocked site data), so every access is wrapped and
 * the latest value is also kept in memory: collapsing still works for this page view.
 */
export const COLLAPSED_STORAGE_KEY = "sp-strategies-collapsed";

let cached: string | null = null;
const listeners = new Set<() => void>();

function readStorage(): string {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getSnapshot(): string {
  if (cached === null) cached = readStorage();
  return cached;
}

const getServerSnapshot = (): string => "";

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSED_STORAGE_KEY || event.key === null) {
      cached = readStorage();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function parseCollapsed(raw: string): Set<number> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : []);
  } catch {
    return new Set();
  }
}

export function setCourseCollapsed(courseId: number, collapsed: boolean): void {
  const ids = parseCollapsed(getSnapshot());
  if (collapsed) ids.add(courseId);
  else ids.delete(courseId);
  cached = ids.size ? JSON.stringify([...ids].sort((a, b) => a - b)) : "";
  try {
    if (cached) window.localStorage.setItem(COLLAPSED_STORAGE_KEY, cached);
    else window.localStorage.removeItem(COLLAPSED_STORAGE_KEY);
  } catch {
    // Not remembered, but still applied for this page view.
  }
  for (const listener of listeners) listener();
}

/** For tests: forget the in-memory copy so the next read comes from storage again. */
export function resetCollapsedCache(): void {
  cached = null;
}

export function useCollapsedCourses(): Set<number> {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => parseCollapsed(raw), [raw]);
}
