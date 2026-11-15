// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMe, getSessionHistory, listPlans } from "@/lib/api";
import { readSidebar, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_STORAGE_KEY, writeSidebar } from "@/lib/sidebar";
import { cleanup, click, render } from "@/test/dom";

import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMe: vi.fn(),
  listPlans: vi.fn(),
  getSessionHistory: vi.fn(),
  updateTimeZone: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getMe).mockResolvedValue({ id: 1, username: "kene", email: "kene@example.com", time_zone: "UTC", time_zone_auto: false });
  vi.mocked(listPlans).mockResolvedValue([]);
  vi.mocked(getSessionHistory).mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  vi.clearAllMocks();
});

function parts(container: HTMLElement) {
  const sidebar = container.querySelector<HTMLElement>("#app-sidebar")!;
  const shell = sidebar.closest<HTMLElement>("[style]")!;
  const toggle = sidebar.querySelector<HTMLButtonElement>("button[aria-controls='app-sidebar']")!;
  return { sidebar, shell, toggle, handle: container.querySelector('[role="separator"]') };
}

describe("AppShell sidebar", () => {
  it("starts expanded at the saved width with a resize handle", async () => {
    writeSidebar({ width: 300, collapsed: false });
    const { container } = await render(<AppShell>page</AppShell>);
    const { sidebar, shell, toggle, handle } = parts(container);
    expect(shell.style.getPropertyValue("--sp-sidebar-width")).toBe("300px");
    expect(sidebar.hasAttribute("data-collapsed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse sidebar");
    expect(handle).not.toBeNull();
  });

  it("collapses to an icon rail, keeps nav names for screen readers, and remembers it", async () => {
    const { container } = await render(<AppShell>page</AppShell>);
    await click(parts(container).toggle);

    const { sidebar, shell, toggle, handle } = parts(container);
    expect(shell.style.getPropertyValue("--sp-sidebar-width")).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`);
    expect(sidebar.hasAttribute("data-collapsed")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand sidebar");
    expect(handle).toBeNull();
    // Labels stay in the DOM (visually hidden by CSS) and show as tooltips.
    const home = sidebar.querySelector<HTMLAnchorElement>('nav a[href="/home"]')!;
    expect(home.textContent).toContain("This week");
    expect(home.title).toBe("This week");
    expect(readSidebar().collapsed).toBe(true);

    await click(toggle);
    expect(parts(container).sidebar.hasAttribute("data-collapsed")).toBe(false);
    expect(readSidebar()).toEqual({ width: 248, collapsed: false });
  });

  it("opens collapsed when that was the saved choice", async () => {
    writeSidebar({ width: 320, collapsed: true });
    const { container } = await render(<AppShell>page</AppShell>);
    const { sidebar, shell } = parts(container);
    expect(sidebar.hasAttribute("data-collapsed")).toBe(true);
    expect(shell.style.getPropertyValue("--sp-sidebar-width")).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`);
  });
});
