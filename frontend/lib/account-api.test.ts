import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  changePassword,
  confirmEmailChange,
  deleteAccount,
  requestEmailChange,
  setTimeZone,
  signOut,
  updateUsername,
} from "./api";
import { getAccessToken, getRefreshToken, setSession } from "./session";

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

type Sent = { path: string; method: string; body: unknown; auth: string | undefined };
let sent: Sent[];

function serve(status: number, body?: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push({
        path: new URL(url).pathname.replace(/^\/api/, ""),
        method: String(init.method),
        body: init.body ? JSON.parse(init.body as string) : undefined,
        auth: headers.Authorization,
      });
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => {
  sent = [];
  const storage = new MemoryStorage();
  storage.setItem("fyp_access_token", "access-1");
  vi.stubGlobal("window", { localStorage: storage, location: { pathname: "/account", search: "", assign: vi.fn() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account API", () => {
  it("changes the username with PATCH /users/me/", async () => {
    serve(200, { id: 1, username: "Kene", email: "k@example.com" });
    await expect(updateUsername("Kene")).resolves.toEqual({ id: 1, username: "Kene", email: "k@example.com" });
    expect(sent).toEqual([{ path: "/users/me/", method: "PATCH", body: { username: "Kene" }, auth: "Bearer access-1" }]);
  });

  it("stores the time zone with PUT /users/me/time-zone/", async () => {
    const me = { id: 1, username: "Kene", email: "k@example.com", time_zone: "Africa/Lagos", time_zone_auto: false };
    serve(200, me);
    await expect(setTimeZone("Africa/Lagos", false)).resolves.toEqual(me);
    expect(sent).toEqual([
      { path: "/users/me/time-zone/", method: "PUT", body: { time_zone: "Africa/Lagos", auto: false }, auth: "Bearer access-1" },
    ]);
  });

  it("sends auto: true when the zone follows the device, and keeps a rejected name's field error", async () => {
    serve(400, { time_zone: ["Unknown time zone."] });
    const failure = await setTimeZone("Mars/Olympus", true).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).fieldErrors.time_zone).toEqual(["Unknown time zone."]);
    expect(sent[0]).toMatchObject({ path: "/users/me/time-zone/", method: "PUT", body: { time_zone: "Mars/Olympus", auto: true } });
  });

  it("changes the password and keeps field errors", async () => {
    serve(400, { current_password: ["That password is incorrect."] });
    const failure = await changePassword({ current_password: "x", new_password: "y" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).fieldErrors.current_password).toEqual(["That password is incorrect."]);
    expect(sent[0]).toMatchObject({ path: "/users/me/password/", method: "POST", body: { current_password: "x", new_password: "y" } });
  });

  it("stores the fresh pair a password change returns, so this tab stays signed in", async () => {
    setSession({ access: "access-1", refresh: "refresh-1" });
    serve(200, { detail: "Your password has been changed.", access: "access-2", refresh: "refresh-2" });
    await expect(changePassword({ current_password: "x", new_password: "y" })).resolves.toEqual({
      detail: "Your password has been changed.",
    });
    expect(getAccessToken()).toBe("access-2");
    expect(getRefreshToken()).toBe("refresh-2");
  });

  it("keeps the session as it was when a password change returns no pair", async () => {
    setSession({ access: "access-1", refresh: "refresh-1" });
    serve(200, { detail: "Your password has been changed." });
    await changePassword({ current_password: "x", new_password: "y" });
    expect(getAccessToken()).toBe("access-1");
    expect(getRefreshToken()).toBe("refresh-1");
  });

  it("requests and confirms an email change", async () => {
    serve(200, { detail: "We sent a code to n@example.com.", email: "n@example.com" });
    await expect(requestEmailChange({ password: "p", new_email: "n@example.com" })).resolves.toMatchObject({ email: "n@example.com" });
    serve(200, { id: 1, username: "kene", email: "n@example.com" });
    await expect(confirmEmailChange("123456")).resolves.toMatchObject({ email: "n@example.com" });
    expect(sent.map(({ path, method, body }) => ({ path, method, body }))).toEqual([
      { path: "/users/me/email/", method: "POST", body: { password: "p", new_email: "n@example.com" } },
      { path: "/users/me/email/confirm/", method: "POST", body: { code: "123456" } },
    ]);
  });

  it("deletes the account and accepts the empty 204", async () => {
    serve(204);
    await expect(deleteAccount({ password: "p", confirm: "DELETE" })).resolves.toBeUndefined();
    expect(sent[0]).toMatchObject({ path: "/users/me/delete/", method: "POST", body: { password: "p", confirm: "DELETE" } });
  });

  it("signs out by clearing the session and revoking the refresh token", async () => {
    setSession({ access: "access-1", refresh: "refresh-1" });
    serve(200, {});
    await signOut();
    expect(getAccessToken()).toBe("");
    expect(getRefreshToken()).toBe("");
    expect(sent).toEqual([{ path: "/auth/token/blacklist/", method: "POST", body: { refresh: "refresh-1" }, auth: undefined }]);
  });

  it("signs out even when the revoke fails", async () => {
    setSession({ access: "access-1", refresh: "refresh-1" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(signOut()).resolves.toBeUndefined();
    expect(getAccessToken()).toBe("");
    expect(getRefreshToken()).toBe("");
    serve(500, {});
    setSession({ access: "access-1", refresh: "refresh-1" });
    await expect(signOut()).resolves.toBeUndefined();
    expect(getRefreshToken()).toBe("");
  });

  it("does not call the server when there is no refresh token", async () => {
    serve(200, {});
    await signOut();
    expect(sent).toEqual([]);
    expect(getAccessToken()).toBe("");
  });
});
