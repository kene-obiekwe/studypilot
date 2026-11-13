// @vitest-environment jsdom
import axe from "axe-core";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, render } from "@/test/dom";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const AWAKE_KEY = "studypilot_backend_awake_at";
const ok = () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });
const down = () => new Response("down", { status: 503 });

let fetchMock: ReturnType<typeof vi.fn>;
let respond: () => Response;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  window.sessionStorage.clear();
  respond = down;
  fetchMock = vi.fn().mockImplementation(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  // Each test gets a fresh api module so an in-flight check is never shared between tests.
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountNotice() {
  const { ServerWakeNotice } = await import("./ServerWakeNotice");
  return render(<ServerWakeNotice />);
}

async function violations(container: HTMLElement): Promise<string[]> {
  // axe schedules its own timeouts, which fake timers would hold back: nudge the clock until it settles.
  let finished = false;
  const run = axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  void run.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  while (!finished) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  }
  const result = await run;
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("ServerWakeNotice", () => {
  it("renders nothing and sends no request when the server was confirmed awake recently", async () => {
    window.sessionStorage.setItem(AWAKE_KEY, String(Date.now() - 60_000));
    const shown = await mountNotice();
    await advance(5000);
    expect(shown.container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks again when the confirmation is older than 10 minutes", async () => {
    window.sessionStorage.setItem(AWAKE_KEY, String(Date.now() - 11 * 60_000));
    respond = ok;
    await mountNotice();
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when the server answers within 1.5 s", async () => {
    respond = ok;
    const shown = await mountNotice();
    await advance(2000);
    expect(shown.container.innerHTML).toBe("");
  });

  it("shows the info notice after 1.5 s, then the success notice once the server answers", async () => {
    const shown = await mountNotice();
    await advance(1499);
    expect(shown.container.textContent).toBe("");
    await advance(1);
    expect(shown.container.textContent).toContain("Starting up the server");
    expect(shown.container.textContent).toContain("Please wait until this message says the server is ready");
    expect(await violations(shown.container)).toEqual([]);

    respond = ok;
    await advance(3000);
    expect(shown.container.textContent).toContain("The server is ready");
    expect(shown.container.textContent).toContain("You can sign in or create an account now.");
    expect(shown.container.textContent).not.toContain("Starting up");
    expect(await violations(shown.container)).toEqual([]);

    await advance(60_000);
    expect(shown.container.textContent).toContain("The server is ready");
  });

  it("shows the warning at 90 s with no ok answer", async () => {
    const shown = await mountNotice();
    await advance(89_000);
    expect(shown.container.textContent).toContain("Starting up the server");
    await advance(1000);
    expect(shown.container.textContent).toContain("This is taking longer than usual");
    expect(shown.container.textContent).toContain("try again in a few minutes");
    expect(await violations(shown.container)).toEqual([]);
  });

  it("does not update state after unmount", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const shown = await mountNotice();
    await advance(500);
    shown.unmount();
    respond = ok;
    await advance(10_000);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("auth layout with the notice", () => {
  it("keeps the form rendered and enabled in every state", async () => {
    const { default: AuthLayout } = await import("../layout");
    const shown = await render(
      <AuthLayout>
        <form>
          <label htmlFor="e">Email</label>
          <input id="e" name="email" />
          <button type="submit">Sign in</button>
        </form>
      </AuthLayout>,
    );
    const check = () => {
      expect((shown.container.querySelector("#e") as HTMLInputElement).disabled).toBe(false);
      expect((shown.container.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
    };
    check();
    await advance(2000);
    expect(shown.container.textContent).toContain("Starting up the server");
    check();
    await advance(90_000);
    expect(shown.container.textContent).toContain("This is taking longer than usual");
    check();
  });
});
