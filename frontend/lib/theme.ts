/**
 * Theme preference store: "light", "dark" or "system" (the default, following
 * prefers-color-scheme). Persisted in localStorage; every access is wrapped because storage can
 * be unavailable (private windows, blocked site data). The resolved theme lives on
 * <html data-theme>, set before paint by THEME_INIT_SCRIPT in the root layout.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sp-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Inlined in <head>. Kept tiny and dependency-free; mirrors resolveTheme below. */
export const THEME_INIT_SCRIPT = `(function(){var p;try{p=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("${DARK_QUERY}").matches);var r=document.documentElement;r.setAttribute("data-theme",d?"dark":"light");r.setAttribute("data-theme-preference",p)})()`;

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

function apply(preference: ThemePreference): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(preference));
  root.setAttribute("data-theme-preference", preference);
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setPreference(preference: ThemePreference): void {
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Not persisted, but still applied for this page view.
  }
  apply(preference);
  notify();
}

/** For useSyncExternalStore: follows other tabs and, under "system", the OS setting. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  const onSystemChange = () => {
    const preference = readPreference();
    if (preference === "system") {
      apply(preference);
      notify();
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      apply(readPreference());
      notify();
    }
  };
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

export const getServerPreference = (): ThemePreference => "system";
