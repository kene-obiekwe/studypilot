// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIVE_MIN = 5 * 60 * 1000;
const AWAKE_KEY = "studypilot_backend_awake_at";

const ok = () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });

async function load() {
  vi.resetModules();
  return await import("./api");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  window.sessionStorage.clear();
  fetchMock = vi.fn().mockImplementation(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("wakeBackend", () => {
  it("starts one CORS health check with no-store", async () => {
    const { wakeBackend } = await load();
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/health\/$/);
    expect(options.cache).toBe("no-store");
    expect(options.mode).toBeUndefined();
  });

  it("does nothing on a second call inside five minutes, then wakes again after", async () => {
    const { wakeBackend } = await load();
    wakeBackend();
    await vi.advanceTimersByTimeAsync(FIVE_MIN - 1000);
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("swallows a rejected fetch without logging", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { wakeBackend } = await load();
    expect(() => wakeBackend()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("swallows a fetch that throws synchronously", async () => {
    fetchMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const { wakeBackend } = await load();
    expect(() => wakeBackend()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("still rate-limits with a module timestamp when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { wakeBackend } = await load();
    wakeBackend();
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remembers the last wake in sessionStorage across module loads", async () => {
    (await load()).wakeBackend();
    (await load()).wakeBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("checkBackend", () => {
  it("is awake on ok + status ok, and stores the time", async () => {
    const { checkBackend } = await load();
    await expect(checkBackend()).resolves.toBe("awake");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(AWAKE_KEY)).toBe(String(Date.now()));
  });

  it("still resolves awake when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { checkBackend } = await load();
    await expect(checkBackend()).resolves.toBe("awake");
  });

  it.each([
    ["a 503", () => new Response("down", { status: 503 })],
    ["an HTML boot page", () => new Response("<html>Starting</html>", { status: 200 })],
    ["the wrong JSON", () => new Response(JSON.stringify({ status: "starting" }), { status: 200 })],
    ["a rejected fetch", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("retries every 3 s after %s", async (_name, bad) => {
    fetchMock.mockImplementationOnce(async () => bad()).mockImplementationOnce(async () => bad());
    const { checkBackend } = await load();
    const result = checkBackend();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(result).resolves.toBe("awake");
  });

  it("gives up with unreachable at 90 s", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    const { checkBackend } = await load();
    let settled: string | null = null;
    void checkBackend().then((value) => {
      settled = value;
    });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe("unreachable");
    expect(window.sessionStorage.getItem(AWAKE_KEY)).toBeNull();
  });

  it("aborts a hung attempt after 15 s and keeps trying", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { checkBackend } = await load();
    const result = checkBackend();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe("awake");
  });

  it("shares one in-flight check between concurrent callers", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("down", { status: 503 }));
    const { checkBackend, wakeBackend } = await load();
    const first = checkBackend();
    const second = checkBackend();
    wakeBackend();
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(first).resolves.toBe("awake");
    // Finished: a new call starts a new check.
    await checkBackend();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("wasBackendRecentlyAwake", () => {
  it("is true for 10 minutes after a confirmation, then false", async () => {
    const { checkBackend, wasBackendRecentlyAwake } = await load();
    expect(wasBackendRecentlyAwake()).toBe(false);
    await checkBackend();
    expect(wasBackendRecentlyAwake()).toBe(true);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 - 1);
    expect(wasBackendRecentlyAwake()).toBe(true);
    vi.setSystemTime(Date.now() + 1);
    expect(wasBackendRecentlyAwake()).toBe(false);
  });

  it("is false when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { wasBackendRecentlyAwake } = await load();
    expect(wasBackendRecentlyAwake()).toBe(false);
  });
});
