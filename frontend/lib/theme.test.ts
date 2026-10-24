import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readPreference, resolveTheme, setPreference, subscribe, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme";

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function fakeDom(systemDark: boolean, storage: unknown = new MemoryStorage()) {
  const attributes = new Map<string, string>();
  const mediaListeners = new Set<() => void>();
  const media = {
    matches: systemDark,
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
  };
  vi.stubGlobal("window", {
    localStorage: storage,
    matchMedia: () => media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    },
  });
  vi.stubGlobal("localStorage", storage);
  return {
    attributes,
    setSystemDark(value: boolean) {
      media.matches = value;
      mediaListeners.forEach((fn) => fn());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme preference", () => {
  beforeEach(() => {
    fakeDom(false);
  });

  it("defaults to system and resolves it from prefers-color-scheme", () => {
    expect(readPreference()).toBe("system");
    expect(resolveTheme("system")).toBe("light");
    fakeDom(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("persists light and dark, and clears the key for system", () => {
    const dom = fakeDom(false);
    setPreference("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(dom.attributes.get("data-theme")).toBe("dark");
    expect(dom.attributes.get("data-theme-preference")).toBe("dark");
    setPreference("system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(dom.attributes.get("data-theme")).toBe("light");
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readPreference()).toBe("system");
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const dom = fakeDom(true, throwing);
    expect(readPreference()).toBe("system");
    expect(() => setPreference("light")).not.toThrow();
    expect(dom.attributes.get("data-theme")).toBe("light");
  });

  it("notifies subscribers and follows the OS while on system", () => {
    const dom = fakeDom(false);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    dom.setSystemDark(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(dom.attributes.get("data-theme")).toBe("dark");
    setPreference("light");
    dom.setSystemDark(false);
    expect(listener).toHaveBeenCalledTimes(2); // the setPreference call, not the OS change
    unsubscribe();
    setPreference("dark");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("THEME_INIT_SCRIPT", () => {
  function run(stored: string | null, systemDark: boolean) {
    const storage = new MemoryStorage();
    if (stored !== null) storage.setItem(THEME_STORAGE_KEY, stored);
    const dom = fakeDom(systemDark, storage);
    new Function(THEME_INIT_SCRIPT)();
    return [dom.attributes.get("data-theme"), dom.attributes.get("data-theme-preference")];
  }

  it("sets data-theme before paint from storage or the OS", () => {
    expect(run(null, false)).toEqual(["light", "system"]);
    expect(run(null, true)).toEqual(["dark", "system"]);
    expect(run("light", true)).toEqual(["light", "light"]);
    expect(run("dark", false)).toEqual(["dark", "dark"]);
    expect(run("bogus", true)).toEqual(["dark", "system"]);
  });

  it("still sets a theme when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    const attributes = new Map<string, string>();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => attributes.set(k, v) } });
    new Function(THEME_INIT_SCRIPT)();
    expect(attributes.get("data-theme")).toBe("dark");
  });
});
