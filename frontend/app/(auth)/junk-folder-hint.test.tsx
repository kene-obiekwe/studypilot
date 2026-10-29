// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, flush, render, submit, typeInto, byLabel } from "@/test/dom";

const api = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
vi.mock("@/lib/session", () => ({ setSession: vi.fn(), hasSession: vi.fn(() => false) }));

import { JUNK_FOLDER_HINT } from "./_components/JunkFolderHint";
import ForgotPasswordPage from "./forgot-password/page";
import VerifyEmailPage from "./verify-email/page";

beforeEach(() => api.requestPasswordReset.mockReset());
afterEach(cleanup);

const hints = (container: HTMLElement) => [...container.querySelectorAll("p")].filter((p) => p.textContent === JUNK_FOLDER_HINT);

describe("junk folder hint", () => {
  it("says to check spam or junk, in plain words", () => {
    expect(JUNK_FOLDER_HINT).toBe("Can't find it? Check your spam or junk folder. It can take a minute.");
  });

  it("shows once on the verify-email page, right under the heading text", async () => {
    const { container } = await render(<VerifyEmailPage />);
    await flush();
    expect(hints(container)).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Check your email");
    expect(container.querySelector("h1")?.nextElementSibling?.nextElementSibling).toBe(hints(container)[0]);
  });

  it("shows on the forgot-password code step but not on the email step", async () => {
    api.requestPasswordReset.mockResolvedValue({ detail: "ok" });
    const { container } = await render(<ForgotPasswordPage />);
    await flush();
    expect(hints(container)).toHaveLength(0);
    await typeInto(byLabel(container, "Email") as HTMLInputElement, "ada@example.com");
    await submit(container.querySelector("form") as HTMLFormElement);
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("Enter your code");
    expect(hints(container)).toHaveLength(1);
  });
});
