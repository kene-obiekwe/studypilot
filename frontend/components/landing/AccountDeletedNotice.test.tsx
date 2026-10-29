// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, render } from "@/test/dom";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.value) }));

import { AccountDeletedNotice } from "./AccountDeletedNotice";

afterEach(cleanup);

describe("AccountDeletedNotice", () => {
  it("says the account was deleted only for the ?account=deleted flag", async () => {
    search.value = "account=deleted";
    const shown = await render(<AccountDeletedNotice />);
    expect(shown.container.querySelector('[role="status"]')?.textContent).toBe("Your account was deleted.");

    search.value = "";
    const hidden = await render(<AccountDeletedNotice />);
    expect(hidden.container.textContent).toBe("");
  });
});
