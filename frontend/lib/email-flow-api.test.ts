import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  confirmPasswordReset,
  EMAIL_NOT_VERIFIED_CODE,
  isEmailNotVerified,
  loginUser,
  requestPasswordReset,
  resendCode,
  startRegistration,
  toApiError,
  verifyEmail,
} from "./api";

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

type Sent = { path: string; method: string; body: string | undefined; auth: string | undefined };
let sent: Sent[];

function serve(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push({
        path: new URL(url).pathname.replace(/^\/api/, ""),
        method: String(init.method),
        body: init.body as string | undefined,
        auth: headers.Authorization,
      });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

const bodyOf = (index = 0) => JSON.parse(sent[index].body ?? "null") as unknown;

beforeEach(() => {
  sent = [];
  vi.stubGlobal("window", {
    localStorage: new MemoryStorage(),
    location: { pathname: "/auth", search: "", assign: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email verification client", () => {
  it("startRegistration posts the details without a bearer token and returns the new response", async () => {
    serve(201, { status: "verification_required", email: "a@example.com" });
    const result = await startRegistration({ username: "ada", email: "a@example.com", password: "Quartz-Meadow-4471" });
    expect(result).toEqual({ status: "verification_required", email: "a@example.com" });
    expect(sent[0]).toMatchObject({ path: "/users/register/", method: "POST", auth: undefined });
    expect(bodyOf()).toEqual({ username: "ada", email: "a@example.com", password: "Quartz-Meadow-4471" });
  });

  it("verifyEmail posts email and code and returns the tokens", async () => {
    serve(200, { access: "a", refresh: "r" });
    await expect(verifyEmail("a@example.com", "123456")).resolves.toEqual({ access: "a", refresh: "r" });
    expect(sent[0]).toMatchObject({ path: "/users/verify-email/", method: "POST", auth: undefined });
    expect(bodyOf()).toEqual({ email: "a@example.com", code: "123456" });
  });

  it("verifyEmail surfaces a wrong code as a readable error", async () => {
    serve(400, { detail: "That code is incorrect or has expired. Request a new one." });
    const error = await verifyEmail("a@example.com", "000000").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe("That code is incorrect or has expired. Request a new one.");
    expect(isEmailNotVerified(error)).toBe(false);
  });

  it("resendCode always sends the verify purpose", async () => {
    serve(200, { detail: "If that email belongs to an account that needs a code, we have sent one." });
    await resendCode("a@example.com");
    expect(sent[0]).toMatchObject({ path: "/users/resend-code/", method: "POST", auth: undefined });
    expect(bodyOf()).toEqual({ email: "a@example.com", purpose: "verify" });
  });

  it("requestPasswordReset posts only the email", async () => {
    serve(200, { detail: "ok" });
    await expect(requestPasswordReset("a@example.com")).resolves.toEqual({ detail: "ok" });
    expect(sent[0]).toMatchObject({ path: "/users/password-reset/request/", method: "POST", auth: undefined });
    expect(bodyOf()).toEqual({ email: "a@example.com" });
  });

  it("confirmPasswordReset posts email, code and new_password", async () => {
    serve(200, { detail: "Your password has been reset. You can sign in now." });
    await confirmPasswordReset({ email: "a@example.com", code: "123456", new_password: "Granite-Harbour-9082" });
    expect(sent[0]).toMatchObject({ path: "/users/password-reset/confirm/", method: "POST", auth: undefined });
    expect(bodyOf()).toEqual({ email: "a@example.com", code: "123456", new_password: "Granite-Harbour-9082" });
  });

  it("confirmPasswordReset keeps password validator messages on fieldErrors", async () => {
    serve(400, { new_password: ["This password is too common."] });
    const error = await confirmPasswordReset({ email: "a@example.com", code: "123456", new_password: "password123" }).catch(
      (e: unknown) => e,
    );
    expect((error as ApiError).fieldErrors.new_password).toEqual(["This password is too common."]);
    expect((error as ApiError).message).toBe("New Password: This password is too common.");
  });
});

describe("unverified sign-in", () => {
  const BODY = { detail: "Verify your email first.", code: "email_not_verified" };

  it("is recognised by isEmailNotVerified and carries the message", async () => {
    serve(400, BODY);
    const error = await loginUser({ identifier: "ada", password: "Quartz-Meadow-4471" }).catch((e: unknown) => e);
    expect(isEmailNotVerified(error)).toBe(true);
    expect((error as ApiError).code).toBe(EMAIL_NOT_VERIFIED_CODE);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe("Verify your email first.");
    expect((error as ApiError).fieldErrors).toEqual({});
  });

  it("does not leak the code into the readable message", () => {
    const error = toApiError(400, BODY);
    expect(error.message).toBe("Verify your email first.");
    expect(error.message).not.toContain("email_not_verified");
  });

  it("is not triggered by an ordinary failed sign-in", async () => {
    serve(401, { detail: "Incorrect username, email or password." });
    const error = await loginUser({ identifier: "ada", password: "nope" }).catch((e: unknown) => e);
    expect(isEmailNotVerified(error)).toBe(false);
    expect((error as ApiError).code).toBe("");
  });

  it("isEmailNotVerified ignores values that are not ApiErrors", () => {
    expect(isEmailNotVerified(new Error("Verify your email first."))).toBe(false);
    expect(isEmailNotVerified(null)).toBe(false);
  });
});
