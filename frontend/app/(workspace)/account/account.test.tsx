// @vitest-environment jsdom
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShellDataProvider } from "@/components/app-shell/ShellData";
import { UserMenu } from "@/components/app-shell/UserMenu";
import {
  ApiError,
  changePassword,
  confirmEmailChange,
  deleteAccount,
  getMe,
  getSessionHistory,
  listCourses,
  listPlans,
  requestEmailChange,
  updateUsername,
  type Course,
  type Me,
} from "@/lib/api";
import { clearSession } from "@/lib/session";
import { getTimerSnapshot, startTimer } from "@/lib/timer-store";
import { byLabel, cleanup, click, flush, render, submit, typeInto } from "@/test/dom";

import { COLLAPSED_STORAGE_KEY, resetCollapsedCache } from "../strategies/collapsed-courses";
import { MISMATCH_MESSAGE } from "./PasswordSection";
import AccountPage from "./page";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/account",
  useSearchParams: () => new URLSearchParams(""),
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
  listCourses: vi.fn(),
  updateUsername: vi.fn(),
  changePassword: vi.fn(),
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  clearSession: vi.fn(),
}));

const ME: Me = { id: 7, username: "kene", email: "kene@example.com" };

// jsdom has no modal dialogs: open and close them by attribute.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  vi.mocked(getMe).mockResolvedValue(ME);
  vi.mocked(listPlans).mockResolvedValue([]);
  vi.mocked(getSessionHistory).mockResolvedValue({ items: [] });
  vi.mocked(listCourses).mockResolvedValue([]);
  window.localStorage.clear();
  resetCollapsedCache();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(withMenu = false) {
  const { container } = await render(
    <ShellDataProvider>
      {withMenu && <UserMenu placement="sidebar" />}
      <AccountPage />
    </ShellDataProvider>,
  );
  await flush();
  return container;
}

const text = (root: ParentNode = document.body) => (root.textContent ?? "").replace(/\s+/g, " ");
const input = (container: HTMLElement, label: string) => byLabel(container, label) as HTMLInputElement;
function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}
const formOf = (element: HTMLElement) => element.closest("form") as HTMLFormElement;
const dialog = () => document.querySelector("dialog") as HTMLDialogElement;

async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

describe("username", () => {
  it("saves, shows a notice and refreshes the account menu without a reload", async () => {
    const container = await renderPage(true);
    expect(text(container)).toContain("kene");
    vi.mocked(updateUsername).mockResolvedValue({ ...ME, username: "Kene_O" });
    vi.mocked(getMe).mockResolvedValue({ ...ME, username: "Kene_O" });

    const field = input(container, "Username");
    expect(field.value).toBe("kene");
    await typeInto(field, "  Kene_O ");
    await submit(formOf(field));
    await flush();

    expect(updateUsername).toHaveBeenCalledWith("Kene_O");
    expect(text(container)).toContain("Your username is now Kene_O.");
    expect(getMe).toHaveBeenCalledTimes(2);
    const menuButton = container.querySelector("button[popovertarget]") as HTMLElement;
    expect(menuButton.textContent).toContain("Kene_O");
  });

  it("puts a taken name on the field", async () => {
    const container = await renderPage();
    vi.mocked(updateUsername).mockRejectedValue(
      new ApiError(400, "Username: taken", { username: ["A user with that username already exists."] }),
    );
    const field = input(container, "Username");
    await typeInto(field, "Other");
    await submit(formOf(field));
    await flush();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(text(container)).toContain("A user with that username already exists.");
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("does not send an unchanged or empty name", async () => {
    const container = await renderPage();
    const field = input(container, "Username");
    await submit(formOf(field));
    expect(text(container)).toContain("That is already your username.");
    await typeInto(field, "  ");
    await submit(formOf(field));
    expect(text(container)).toContain("Enter a username.");
    expect(updateUsername).not.toHaveBeenCalled();
  });
});

describe("password", () => {
  async function fill(container: HTMLElement, current: string, next: string, confirm: string) {
    await typeInto(input(container, "Current password"), current);
    await typeInto(input(container, "New password"), next);
    await typeInto(input(container, "Confirm new password"), confirm);
    await submit(formOf(input(container, "Current password")));
    await flush();
  }

  it("checks that the two new passwords match before sending", async () => {
    const container = await renderPage();
    await fill(container, "Old-Password-1", "Granite-Harbour-9082", "Granite-Harbour-9083");
    expect(text(container)).toContain(MISMATCH_MESSAGE);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("changes the password, clears the fields and says so", async () => {
    const container = await renderPage();
    vi.mocked(changePassword).mockResolvedValue({ detail: "Your password has been changed." });
    await fill(container, "Old-Password-1", "Granite-Harbour-9082", "Granite-Harbour-9082");
    expect(changePassword).toHaveBeenCalledWith({ current_password: "Old-Password-1", new_password: "Granite-Harbour-9082" });
    expect(text(container)).toContain("Your password has been changed.");
    expect(input(container, "Current password").value).toBe("");
    expect(input(container, "New password").value).toBe("");
    expect(input(container, "New password").getAttribute("aria-describedby")).toBeTruthy();
    expect(text(container)).toContain("At least 8 characters.");
  });

  it("shows a wrong current password and a weak new one on their fields", async () => {
    const container = await renderPage();
    vi.mocked(changePassword).mockRejectedValueOnce(
      new ApiError(400, "x", { current_password: ["That password is incorrect."] }),
    );
    await fill(container, "wrong-one-1", "Granite-Harbour-9082", "Granite-Harbour-9082");
    expect(input(container, "Current password").getAttribute("aria-invalid")).toBe("true");
    expect(text(container)).toContain("That password is incorrect.");

    vi.mocked(changePassword).mockRejectedValueOnce(new ApiError(400, "x", { new_password: ["This password is too common."] }));
    await submit(formOf(input(container, "Current password")));
    await flush();
    expect(input(container, "New password").getAttribute("aria-invalid")).toBe("true");
    expect(text(container)).toContain("This password is too common.");
    expect(text(container)).not.toContain("Your password has been changed.");
  });
});

describe("email", () => {
  async function startChange(container: HTMLElement, email = "new@example.com", password = "Quartz-Meadow-4471") {
    await click(button(container, "Change email"));
    await typeInto(input(container, "New email"), email);
    await typeInto(input(container, "Password"), password);
    await submit(formOf(input(container, "New email")));
    await flush();
  }

  it("sends a code to the new address, then confirms it and refreshes the shell", async () => {
    const container = await renderPage(true);
    expect(text(container)).toContain("kene@example.com");
    vi.mocked(requestEmailChange).mockResolvedValue({ detail: "We sent a code to new@example.com.", email: "new@example.com" });
    await startChange(container, " new@example.com ");
    expect(requestEmailChange).toHaveBeenCalledWith({ password: "Quartz-Meadow-4471", new_email: "new@example.com" });
    expect(text(container)).toContain("We sent a code to new@example.com. Check your spam or junk folder.");
    expect(button(container, "Send a new code in 60 s").disabled).toBe(true);

    vi.mocked(confirmEmailChange).mockResolvedValue({ ...ME, email: "new@example.com" });
    vi.mocked(getMe).mockResolvedValue({ ...ME, email: "new@example.com" });
    await typeInto(input(container, "6-digit code"), "123456");
    await flush();
    expect(confirmEmailChange).toHaveBeenCalledWith("123456");
    expect(text(container)).toContain("Your email is now new@example.com.");
    expect(getMe).toHaveBeenCalledTimes(2);
    const menuEmail = [...container.querySelectorAll("[popover] p")].map((p) => p.textContent);
    expect(menuEmail).toContain("new@example.com");
  });

  it("shows a taken address and a wrong password on their fields", async () => {
    const container = await renderPage();
    vi.mocked(requestEmailChange).mockRejectedValueOnce(new ApiError(400, "x", { new_email: ["That email is already in use."] }));
    await startChange(container, "other@example.com");
    expect(input(container, "New email").getAttribute("aria-invalid")).toBe("true");
    expect(text(container)).toContain("That email is already in use.");

    vi.mocked(requestEmailChange).mockRejectedValueOnce(new ApiError(400, "x", { password: ["That password is incorrect."] }));
    await submit(formOf(input(container, "New email")));
    await flush();
    expect(input(container, "Password").getAttribute("aria-invalid")).toBe("true");
    expect(text(container)).toContain("That password is incorrect.");
  });

  it("needs both fields before sending", async () => {
    const container = await renderPage();
    await click(button(container, "Change email"));
    await submit(formOf(input(container, "New email")));
    expect(text(container)).toContain("Enter your new email address.");
    expect(text(container)).toContain("Enter your password.");
    expect(requestEmailChange).not.toHaveBeenCalled();
  });

  it("puts a wrong code on the code field and keeps the old address", async () => {
    const container = await renderPage();
    vi.mocked(requestEmailChange).mockResolvedValue({ detail: "sent", email: "new@example.com" });
    await startChange(container);
    vi.mocked(confirmEmailChange).mockRejectedValue(new ApiError(400, "That code is incorrect or has expired. Request a new one."));
    await typeInto(input(container, "6-digit code"), "000000");
    await flush();
    expect(text(container)).toContain("That code is incorrect or has expired.");
    expect(input(container, "6-digit code").value).toBe("");
    expect(getMe).toHaveBeenCalledTimes(1);

    await click(button(container, "Cancel"));
    expect(text(container)).toContain("kene@example.com");
  });
});

describe("delete account", () => {
  async function openDialog() {
    const container = await renderPage();
    await click(button(container, "Delete account"));
    return container;
  }

  it("explains what is removed and keeps the button off until DELETE is typed", async () => {
    await openDialog();
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(text(dialog())).toContain("Your courses");
    expect(text(dialog())).toContain("Your logged study sessions");
    const remove = button(dialog(), "Delete account");
    expect(remove.disabled).toBe(true);
    const confirm = input(dialog() as unknown as HTMLElement, "Type DELETE to confirm");
    await typeInto(confirm, "delete");
    expect(remove.disabled).toBe(true);
    await typeInto(confirm, "DELETE");
    expect(remove.disabled).toBe(false);
  });

  it("asks for the password before sending anything", async () => {
    await openDialog();
    await typeInto(input(dialog() as unknown as HTMLElement, "Type DELETE to confirm"), "DELETE");
    await submit(dialog().querySelector("form")!);
    expect(text(dialog())).toContain("Enter your password.");
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("shows a wrong password and keeps the account and session", async () => {
    await openDialog();
    vi.mocked(deleteAccount).mockRejectedValue(new ApiError(400, "x", { password: ["That password is incorrect."] }));
    await typeInto(input(dialog() as unknown as HTMLElement, "Password"), "wrong-one-1");
    await typeInto(input(dialog() as unknown as HTMLElement, "Type DELETE to confirm"), "DELETE");
    await submit(dialog().querySelector("form")!);
    await flush();
    expect(text(dialog())).toContain("That password is incorrect.");
    expect(clearSession).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("deletes, clears this user's local data and the session, then goes home with a notice flag", async () => {
    startTimer({ userId: ME.id, courseId: 10, courseName: "Calculus", startedAt: Date.now(), plannedMinutes: 50 });
    window.localStorage.setItem(`sp-onboarding-done:${ME.id}`, "1");
    window.localStorage.setItem("sp-onboarding-done:99", "1");
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, "[10,20]");
    window.localStorage.setItem("sp-theme", "dark");
    vi.mocked(listCourses).mockResolvedValue([{ id: 10 } as Course]);
    vi.mocked(deleteAccount).mockResolvedValue();

    await openDialog();
    await typeInto(input(dialog() as unknown as HTMLElement, "Password"), "Quartz-Meadow-4471");
    await typeInto(input(dialog() as unknown as HTMLElement, "Type DELETE to confirm"), "DELETE");
    await submit(dialog().querySelector("form")!);
    await flush();

    expect(deleteAccount).toHaveBeenCalledWith({ password: "Quartz-Meadow-4471", confirm: "DELETE" });
    expect(getTimerSnapshot()).toBeNull();
    expect(window.localStorage.getItem(`sp-onboarding-done:${ME.id}`)).toBeNull();
    expect(window.localStorage.getItem("sp-onboarding-done:99")).toBe("1");
    expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe("[20]");
    expect(window.localStorage.getItem("sp-theme")).toBe("dark");
    expect(clearSession).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/?account=deleted");
  });

  it("leaves another account's timer running", async () => {
    startTimer({ userId: 99, courseId: 30, courseName: "Other", startedAt: Date.now(), plannedMinutes: 50 });
    vi.mocked(deleteAccount).mockResolvedValue();
    await openDialog();
    await typeInto(input(dialog() as unknown as HTMLElement, "Password"), "Quartz-Meadow-4471");
    await typeInto(input(dialog() as unknown as HTMLElement, "Type DELETE to confirm"), "DELETE");
    await submit(dialog().querySelector("form")!);
    await flush();
    expect(getTimerSnapshot()).not.toBeNull();
  });
});

describe("account page passes axe", () => {
  it("by default", async () => {
    const container = await renderPage();
    expect(await violations(container)).toEqual([]);
  });

  it("with the email code step open", async () => {
    const container = await renderPage();
    vi.mocked(requestEmailChange).mockResolvedValue({ detail: "sent", email: "new@example.com" });
    await click(button(container, "Change email"));
    expect(await violations(container)).toEqual([]);
    await typeInto(input(container, "New email"), "new@example.com");
    await typeInto(input(container, "Password"), "Quartz-Meadow-4471");
    await submit(formOf(input(container, "New email")));
    await flush();
    expect(await violations(container)).toEqual([]);
  });

  it("with the delete dialog open", async () => {
    const container = await renderPage();
    await click(button(container, "Delete account"));
    expect(await violations(container)).toEqual([]);
  });
});
