// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, render } from "@/test/dom";

const wake = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ wakeBackend: wake }));

import { WakeBackend } from "./WakeBackend";

afterEach(cleanup);

describe("WakeBackend", () => {
  it("calls wakeBackend once on mount and renders nothing", async () => {
    const shown = await render(<WakeBackend />);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(shown.container.innerHTML).toBe("");
  });
});
