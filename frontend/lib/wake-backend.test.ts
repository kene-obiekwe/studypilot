// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIVE_MIN = 5 * 60 * 1000;

async function load() {
  vi.resetModules();
  return (await import("./api")).wakeBackend;
}

describe("wakeBackend", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    window.sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the health endpoint once with no-cors and no-store", async () => {
    const wakeBackend = await load();
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/health\/$/);
    expect(options).toEqual({ mode: "no-cors", cache: "no-store" });
  });

  it("does nothing on a second call inside five minutes, then wakes again after", async () => {
    const wakeBackend = await load();
    wakeBackend();
    vi.advanceTimersByTime(FIVE_MIN - 1000);
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("swallows a rejected fetch without logging", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const wakeBackend = await load();
    expect(() => wakeBackend()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("swallows a fetch that throws synchronously", async () => {
    fetchMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const wakeBackend = await load();
    expect(() => wakeBackend()).not.toThrow();
  });

  it("still rate-limits with a module timestamp when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const wakeBackend = await load();
    wakeBackend();
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FIVE_MIN);
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remembers the last wake in sessionStorage across module loads", async () => {
    (await load())();
    (await load())();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
