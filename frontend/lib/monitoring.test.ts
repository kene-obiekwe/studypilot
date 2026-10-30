// @vitest-environment jsdom
import type { Breadcrumb, ErrorEvent } from "@sentry/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  breadcrumbsIntegration: vi.fn((options?: unknown) => ({ name: "Breadcrumbs", options })),
}));
vi.mock("@sentry/browser", () => sentry);

const DSN = "https://publickey@o0.ingest.sentry.io/0";

async function load() {
  vi.resetModules();
  return import("./monitoring");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("without a DSN", () => {
  it("starts nothing and reports nothing", async () => {
    const { initMonitoring, reportError } = await load();
    initMonitoring();
    reportError(new Error("boom"));
    await Promise.resolve();
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("treats a blank DSN as off", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "   ");
    const { initMonitoring } = await load();
    initMonitoring();
    await Promise.resolve();
    expect(sentry.init).not.toHaveBeenCalled();
  });
});

describe("with a DSN", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
  });

  it("starts once, however often it is called", async () => {
    const { initMonitoring } = await load();
    initMonitoring();
    initMonitoring();
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
    initMonitoring();
    await Promise.resolve();
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("does not start on the server", async () => {
    vi.stubGlobal("window", undefined);
    const { initMonitoring } = await load();
    initMonitoring();
    await Promise.resolve();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("asks for errors only and no personal data", async () => {
    const { initMonitoring, beforeSend } = await load();
    initMonitoring();
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalled());
    const options = sentry.init.mock.calls[0][0];
    expect(options.dsn).toBe(DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(beforeSend);
    for (const key of ["tracesSampleRate", "tracesSampler", "replaysSessionSampleRate", "replaysOnErrorSampleRate", "profilesSampleRate"]) {
      expect(options).not.toHaveProperty(key);
    }
    const integrations = options.integrations([{ name: "Breadcrumbs" }, { name: "Dedupe" }, { name: "Console" }]);
    expect(integrations.map((item: { name: string }) => item.name)).toEqual(["Dedupe", "Breadcrumbs"]);
    expect(sentry.breadcrumbsIntegration).toHaveBeenCalledWith({ dom: false });
  });

  it("names the environment from the build, or from NEXT_PUBLIC_SENTRY_ENVIRONMENT", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let { initMonitoring } = await load();
    initMonitoring();
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
    expect(sentry.init.mock.calls[0][0].environment).toBe("production");

    vi.stubEnv("NODE_ENV", "development");
    ({ initMonitoring } = await load());
    initMonitoring();
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(2));
    expect(sentry.init.mock.calls[1][0].environment).toBe("development");

    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "preview");
    ({ initMonitoring } = await load());
    initMonitoring();
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(3));
    expect(sentry.init.mock.calls[2][0].environment).toBe("preview");
  });

  it("reportError starts the SDK if needed and sends the error", async () => {
    const { reportError } = await load();
    const error = new Error("boom");
    reportError(error);
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledWith(error));
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("reportError never throws when sending fails", async () => {
    sentry.captureException.mockImplementationOnce(() => {
      throw new Error("transport down");
    });
    const { reportError } = await load();
    expect(() => reportError(new Error("boom"))).not.toThrow();
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalled());
  });
});

describe("beforeSend", () => {
  async function clean(event: Partial<ErrorEvent>): Promise<ErrorEvent> {
    const { beforeSend } = await load();
    return beforeSend({ type: undefined, ...event } as ErrorEvent);
  }

  it("drops the query string and fragment from the page address", async () => {
    const event = await clean({ request: { url: "https://studypilot.app/verify-email?code=123456&email=a%40b.c#top" } });
    expect(event.request?.url).toBe("https://studypilot.app/verify-email");
  });

  it("removes the query string, cookies, body and sensitive headers from the request", async () => {
    const event = await clean({
      request: {
        url: "https://studypilot.app/home",
        query_string: "code=123456",
        cookies: { a: "b" },
        data: { password: "x" },
        headers: { Referer: "https://studypilot.app/reset?token=abc", "User-Agent": "Mozilla", Cookie: "a=b" },
      },
    });
    expect(event.request).toEqual({ url: "https://studypilot.app/home", headers: { "User-Agent": "Mozilla" } });
  });

  it("removes user info", async () => {
    const event = await clean({ user: { id: "1", email: "a@b.c", username: "ada", ip_address: "203.0.113.9" } });
    expect(event).not.toHaveProperty("user");
  });

  it("drops query strings and fragments from breadcrumb addresses", async () => {
    const breadcrumbs: Breadcrumb[] = [
      { category: "fetch", data: { url: "https://api.example.com/api/courses/?page=2", method: "GET" } },
      { category: "navigation", data: { from: "/reset?token=abc", to: "/home#week" } },
      { category: "ui.click", message: "button" },
    ];
    const event = await clean({ breadcrumbs });
    expect(event.breadcrumbs?.[0].data).toEqual({ url: "https://api.example.com/api/courses/", method: "GET" });
    expect(event.breadcrumbs?.[1].data).toEqual({ from: "/reset", to: "/home" });
    expect(event.breadcrumbs?.[2]).toEqual({ category: "ui.click", message: "button" });
  });

  it("keeps the error itself", async () => {
    const exception = { values: [{ type: "Error", value: "boom" }] };
    const event = await clean({ exception, message: "boom" });
    expect(event.exception).toBe(exception);
    expect(event.message).toBe("boom");
  });

  it("passes an event with no request or breadcrumbs", async () => {
    const event = await clean({ message: "boom" });
    expect(event.message).toBe("boom");
  });
});

describe("stripUrl", () => {
  it("handles addresses with only a fragment, only a query, or neither", async () => {
    const { stripUrl } = await load();
    expect(stripUrl("/a#b")).toBe("/a");
    expect(stripUrl("/a?b=1")).toBe("/a");
    expect(stripUrl("/a")).toBe("/a");
    expect(stripUrl("/a#b?c")).toBe("/a");
  });
});
