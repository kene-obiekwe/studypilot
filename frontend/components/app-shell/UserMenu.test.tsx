// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMe, getSessionHistory, listPlans, signOut } from "@/lib/api";
import { cleanup, click, render } from "@/test/dom";

import { ShellDataProvider } from "./ShellData";
import { UserMenu } from "./UserMenu";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
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
  signOut: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UserMenu", () => {
  it("has an Account link above Sign out, and following it closes the menu", async () => {
    vi.mocked(getMe).mockResolvedValue({ id: 1, username: "kene", email: "kene@example.com", time_zone: null, time_zone_auto: false });
    vi.mocked(listPlans).mockResolvedValue([]);
    vi.mocked(getSessionHistory).mockResolvedValue({ items: [] });
    const { container } = await render(
      <ShellDataProvider>
        <UserMenu placement="sidebar" />
      </ShellDataProvider>,
    );
    const menu = container.querySelector<HTMLElement>("[popover]")!;
    const hidePopover = vi.fn();
    menu.hidePopover = hidePopover;

    const items = [...menu.querySelectorAll("a, button")].map((item) => item.textContent?.trim());
    expect(items.indexOf("Account")).toBeGreaterThan(-1);
    expect(items.indexOf("Account")).toBe(items.indexOf("Sign out") - 1);

    const link = [...menu.querySelectorAll("a")].find((item) => item.textContent?.trim() === "Account")!;
    expect(link.getAttribute("href")).toBe("/account");
    link.addEventListener("click", (event) => event.preventDefault()); // jsdom can't navigate
    await click(link);
    expect(hidePopover).toHaveBeenCalled();
  });

  it("signs out through the API and goes home without waiting for the server", async () => {
    vi.mocked(getMe).mockResolvedValue({ id: 1, username: "kene", email: "kene@example.com", time_zone: null, time_zone_auto: false });
    vi.mocked(listPlans).mockResolvedValue([]);
    vi.mocked(getSessionHistory).mockResolvedValue({ items: [] });
    vi.mocked(signOut).mockReturnValue(new Promise(() => {})); // never settles
    const { container } = await render(
      <ShellDataProvider>
        <UserMenu placement="sidebar" />
      </ShellDataProvider>,
    );
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Sign out")!;
    await click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});
