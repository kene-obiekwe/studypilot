// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/monitoring", () => monitoring);

import GlobalError from "./global-error";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("app/global-error.tsx", () => {
  it("renders its own document with a heading, Try again and a way home, and reports the error once", async () => {
    const retry = vi.fn();
    const error = new Error("password=hunter2");
    // Next renders this in place of the root layout, into the whole document.
    const root = createRoot(document);
    await act(async () => {
      root.render(<GlobalError error={error} retry={retry} />);
    });

    expect(document.documentElement.lang).toBe("en");
    expect(document.body.querySelector("h1")?.textContent).toBe("Something went wrong");
    expect(document.body.textContent).not.toContain("hunter2");
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError).toHaveBeenCalledWith(error);
    expect(document.body.querySelector("a")?.getAttribute("href")).toBe("/");

    const button = document.body.querySelector("button");
    expect(button?.textContent).toBe("Try again");
    await act(async () => {
      button?.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
