// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, getMe, setTimeZone, type Me } from "@/lib/api";
import { lastKnownZone, lastSyncedZone, rememberSyncedZone } from "@/lib/zone";

import { onZoneSynced, resetZoneSync, syncTimeZone, syncTimeZoneAfterSignIn } from "./zone-sync";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMe: vi.fn(),
  setTimeZone: vi.fn(),
}));

const deviceIs = (name: string | undefined) =>
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: name } as unknown as Intl.ResolvedDateTimeFormatOptions);

const account = (overrides: Partial<Me> = {}): Me => ({
  id: 1,
  username: "kene",
  email: "kene@example.com",
  time_zone: "Africa/Lagos",
  time_zone_auto: true,
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
  resetZoneSync();
  vi.mocked(setTimeZone).mockResolvedValue(account({ time_zone: "Asia/Tokyo" }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("syncTimeZone", () => {
  it("sends the device zone once when the account follows the device and differs", async () => {
    deviceIs("Asia/Tokyo");
    expect(await syncTimeZone(account())).toBe(true);
    expect(setTimeZone).toHaveBeenCalledTimes(1);
    expect(setTimeZone).toHaveBeenCalledWith("Asia/Tokyo", true);
    expect(lastSyncedZone()).toBe("Asia/Tokyo");
    expect(lastKnownZone()).toBe("Asia/Tokyo");
  });

  it("never has two PUTs in flight", async () => {
    deviceIs("Asia/Tokyo");
    const first = syncTimeZone(account());
    const second = syncTimeZone(account());
    await Promise.all([first, second]);
    expect(setTimeZone).toHaveBeenCalledTimes(1);
  });

  it("tells listeners when the server took the zone", async () => {
    deviceIs("Asia/Tokyo");
    const listener = vi.fn();
    const stop = onZoneSynced(listener);
    await syncTimeZone(account());
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("sends nothing in manual mode, when the zones match, or before the account is known", async () => {
    deviceIs("Asia/Tokyo");
    await syncTimeZone(account({ time_zone_auto: false }));
    await syncTimeZone(account({ time_zone: "Asia/Tokyo" }));
    await syncTimeZone(null);
    // A backend that predates the field sends neither key.
    await syncTimeZone({ id: 1, username: "k", email: "k@example.com" } as Me);
    expect(setTimeZone).not.toHaveBeenCalled();
  });

  it("sends nothing when the browser reports no zone", async () => {
    deviceIs(undefined);
    await syncTimeZone(account());
    expect(setTimeZone).not.toHaveBeenCalled();
  });

  it("sends nothing for a zone this browser already sent", async () => {
    deviceIs("Asia/Tokyo");
    rememberSyncedZone("Asia/Tokyo");
    await syncTimeZone(account());
    expect(setTimeZone).not.toHaveBeenCalled();
  });

  it("does not retry a name the server rejects", async () => {
    deviceIs("Asia/Tokyo");
    vi.mocked(setTimeZone).mockRejectedValue(new ApiError(400, "x", { time_zone: ["Enter a valid time zone."] }));
    const listener = vi.fn();
    const stop = onZoneSynced(listener);
    expect(await syncTimeZone(account())).toBe(false);
    expect(lastSyncedZone()).toBe("Asia/Tokyo");
    expect(listener).not.toHaveBeenCalled();
    await syncTimeZone(account());
    expect(setTimeZone).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each([
    ["a 404 from a backend that has not deployed yet", new ApiError(404, "Not found")],
    ["a 429", new ApiError(429, "Slow down")],
    ["a 500", new ApiError(500, "Server error")],
    ["a 400 that is not about the zone", new ApiError(400, "Bad request")],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("remembers nothing after %s, so the next load tries again", async (_name, failure) => {
    deviceIs("Asia/Tokyo");
    vi.mocked(setTimeZone).mockRejectedValue(failure);
    expect(await syncTimeZone(account())).toBe(false);
    expect(lastSyncedZone()).toBeNull();
    expect(lastKnownZone()).toBeNull();
    vi.mocked(setTimeZone).mockResolvedValue(account({ time_zone: "Asia/Tokyo" }));
    expect(await syncTimeZone(account())).toBe(true);
    expect(setTimeZone).toHaveBeenCalledTimes(2);
  });
});

describe("syncTimeZoneAfterSignIn", () => {
  it("looks the account up, then syncs it", async () => {
    deviceIs("Asia/Tokyo");
    vi.mocked(getMe).mockResolvedValue(account());
    expect(await syncTimeZoneAfterSignIn()).toBe(true);
    expect(setTimeZone).toHaveBeenCalledWith("Asia/Tokyo", true);
  });

  it("keeps a manual choice made on another device", async () => {
    deviceIs("Asia/Tokyo");
    vi.mocked(getMe).mockResolvedValue(account({ time_zone_auto: false }));
    expect(await syncTimeZoneAfterSignIn()).toBe(false);
    expect(setTimeZone).not.toHaveBeenCalled();
  });

  it("is silent when the account cannot be loaded", async () => {
    deviceIs("Asia/Tokyo");
    vi.mocked(getMe).mockRejectedValue(new ApiError(500, "down"));
    expect(await syncTimeZoneAfterSignIn()).toBe(false);
    expect(setTimeZone).not.toHaveBeenCalled();
  });
});
