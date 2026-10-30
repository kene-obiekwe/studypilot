// @vitest-environment jsdom
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, click, render } from "@/test/dom";

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/monitoring", () => monitoring);

import WorkspaceError from "./(workspace)/error";
import ErrorPage from "./error";
import NotFound from "./not-found";

beforeEach(() => {
  monitoring.reportError.mockClear();
  window.localStorage.clear();
});
afterEach(cleanup);

async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false }, "landmark-one-main": { enabled: false } },
  });
  return result.violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

const secret = new Error("password=hunter2 at /srv/app/views.py:42");

describe.each([
  ["app/error.tsx", ErrorPage],
  ["app/(workspace)/error.tsx", WorkspaceError],
])("%s", (_name, Page) => {
  it("shows a heading and the actions, reports the error once, and shows no error message", async () => {
    const retry = vi.fn();
    const { container } = await render(<Page error={secret} retry={retry} />);
    expect(container.querySelector("h1")?.textContent).toBe("Something went wrong");
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError).toHaveBeenCalledWith(secret);
    expect(container.textContent).not.toContain("hunter2");
    expect(container.textContent).not.toContain("views.py");
    expect(container.textContent).not.toContain("Reference");
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("lucide-triangle-alert");

    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((item) => item.textContent)).toEqual(["Try again"]);
    await click(buttons[0]);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the digest as a reference when there is one", async () => {
    const error = Object.assign(new Error("hidden"), { digest: "abc123" });
    const { container } = await render(<Page error={error} retry={() => undefined} />);
    expect(container.textContent).toContain("Reference: abc123");
    expect(container.textContent).not.toContain("hidden");
  });

  it("links home: the landing page when signed out, the week when signed in", async () => {
    let { container } = await render(<Page error={secret} retry={() => undefined} />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
    cleanup();
    window.localStorage.setItem("fyp_access_token", "token");
    ({ container } = await render(<Page error={secret} retry={() => undefined} />));
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/home");
  });

  it("passes axe", async () => {
    const { container } = await render(<Page error={secret} retry={() => undefined} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe("app/not-found.tsx", () => {
  it("shows the heading and a way home, without Try again or an error report", async () => {
    const { container } = await render(<NotFound />);
    expect(container.querySelector("h1")?.textContent).toBe("Page not found");
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("lucide-compass");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it("links to the week when signed in", async () => {
    window.localStorage.setItem("fyp_refresh_token", "token");
    const { container } = await render(<NotFound />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/home");
  });

  it("passes axe", async () => {
    const { container } = await render(<NotFound />);
    expect(await violations(container)).toEqual([]);
  });
});
