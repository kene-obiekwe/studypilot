// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { byLabel, cleanup, click, flush, render, submit, typeInto } from "@/test/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const api = vi.hoisted(() => ({
  loginUser: vi.fn(),
  startRegistration: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  verifyEmail: vi.fn(),
  resendCode: vi.fn(),
}));
const session = vi.hoisted(() => ({ setSession: vi.fn(), hasSession: vi.fn(() => false) }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), ...api }));
vi.mock("@/lib/session", () => session);

import ForgotPasswordPage from "./forgot-password/page";
import SignInPage from "./sign-in/page";
import SignUpPage from "./sign-up/page";

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  router.push.mockReset();
  router.replace.mockReset();
  session.setSession.mockReset();
  session.hasSession.mockReturnValue(false);
});

afterEach(cleanup);

const toggles = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].filter((button) => /^(Show|Hide) password$/.test(button.getAttribute("aria-label") ?? ""));
const input = (container: HTMLElement, label: string) => byLabel(container, label) as HTMLInputElement;

describe("sign in", () => {
  it("asks for a username or email, and still hints the browser it is the username", async () => {
    const { container } = await render(<SignInPage />);
    await flush();
    const identifier = input(container, "Username or email");
    expect(identifier.getAttribute("autocomplete")).toBe("username");
    expect(identifier.type).toBe("text");
    expect(container.textContent).not.toMatch(/Username\s*\*/);
  });

  it("has one show-password toggle, and the field keeps its current-password hint", async () => {
    const { container } = await render(<SignInPage />);
    await flush();
    expect(toggles(container)).toHaveLength(1);
    const password = input(container, "Password");
    expect(password.type).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    await click(toggles(container)[0]);
    expect(password.type).toBe("text");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });

  it("sends what was typed, trimmed, as the identifier: an email is not rewritten", async () => {
    api.loginUser.mockResolvedValue({ access: "a", refresh: "r" });
    const { container } = await render(<SignInPage />);
    await flush();
    await typeInto(input(container, "Username or email"), "  Ada.Lovelace@Example.com ");
    await typeInto(input(container, "Password"), "Quartz-Meadow-4471");
    await submit(container.querySelector("form") as HTMLFormElement);
    await flush();
    expect(api.loginUser).toHaveBeenCalledWith({ identifier: "Ada.Lovelace@Example.com", password: "Quartz-Meadow-4471" });
    expect(session.setSession).toHaveBeenCalledWith({ access: "a", refresh: "r" });
    expect(router.replace).toHaveBeenCalledWith("/home");
  });

  it("hides the password again after a successful sign-in", async () => {
    api.loginUser.mockResolvedValue({ access: "a", refresh: "r" });
    const { container } = await render(<SignInPage />);
    await flush();
    await typeInto(input(container, "Username or email"), "ada");
    await typeInto(input(container, "Password"), "Quartz-Meadow-4471");
    await click(toggles(container)[0]);
    expect(input(container, "Password").type).toBe("text");
    await submit(container.querySelector("form") as HTMLFormElement);
    await flush();
    expect(input(container, "Password").type).toBe("password");
  });

  it("keeps the password revealed when the sign-in fails", async () => {
    api.loginUser.mockRejectedValue(new Error("No account found with those details."));
    const { container } = await render(<SignInPage />);
    await flush();
    await typeInto(input(container, "Username or email"), "ada");
    await typeInto(input(container, "Password"), "wrong-wrong-1");
    await click(toggles(container)[0]);
    await submit(container.querySelector("form") as HTMLFormElement);
    await flush();
    expect(container.textContent).toContain("No account found with those details.");
    expect(input(container, "Password").type).toBe("text");
  });
});

describe("sign up", () => {
  it("has a show-password toggle that keeps the new-password hint, and hides again after submitting", async () => {
    api.startRegistration.mockResolvedValue({ status: "verification_required", email: "a@b.co" });
    const { container } = await render(<SignUpPage />);
    await flush();
    expect(toggles(container)).toHaveLength(1);
    const password = input(container, "Password");
    expect(password.getAttribute("autocomplete")).toBe("new-password");
    await typeInto(input(container, "Username"), "ada");
    await typeInto(input(container, "Email"), "a@b.co");
    await typeInto(password, "Quartz-Meadow-4471");
    await click(toggles(container)[0]);
    expect(password.type).toBe("text");
    await submit(container.querySelector("form") as HTMLFormElement);
    await flush();
    expect(password.type).toBe("password");
    expect(router.push).toHaveBeenCalled();
  });
});

describe("forgot password", () => {
  async function toNewPasswordStep() {
    api.requestPasswordReset.mockResolvedValue({ detail: "ok" });
    const view = await render(<ForgotPasswordPage />);
    await flush();
    await typeInto(input(view.container, "Email"), "ada@example.com");
    await submit(view.container.querySelector("form") as HTMLFormElement);
    await flush();
    return view;
  }

  it("has a toggle on the new password and the confirmation, which reveal together", async () => {
    const { container } = await toNewPasswordStep();
    expect(toggles(container)).toHaveLength(2);
    const fields = [input(container, "New password"), input(container, "Confirm new password")];
    expect(fields.map((field) => field.getAttribute("autocomplete"))).toEqual(["new-password", "new-password"]);
    expect(fields.map((field) => field.type)).toEqual(["password", "password"]);
    await click(toggles(container)[1]);
    expect(fields.map((field) => field.type)).toEqual(["text", "text"]);
    expect(toggles(container).map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
  });
});
