// @vitest-environment jsdom
import { act, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMe, getSessionHistory, listPlans, setTimeZone, type SessionHistoryItem } from "@/lib/api";
import { notifySessionsChanged } from "@/lib/timer-refresh";
import { render } from "@/test/dom";

import { ShellDataProvider, useShellData } from "./ShellData";
import { useTimeZone } from "./useTimeZone";
import { resetZoneSync } from "./zone-sync";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMe: vi.fn(),
  listPlans: vi.fn(),
  getSessionHistory: vi.fn(),
  setTimeZone: vi.fn(),
}));

function session(minutes: number): SessionHistoryItem {
  return {
    id: minutes,
    course_name: "Calculus",
    planned_minutes: 60,
    actual_minutes: minutes,
    focus_score: 0.6,
    completion_rate: 0.5,
    adherence_score: 1,
    predicted_adherence: null,
    model_version: "v",
    created_at: new Date().toISOString(),
  };
}

function Logged() {
  const { week, sessions } = useShellData();
  return (
    <p>
      {week?.loggedHours} h from {sessions?.length} sessions
    </p>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  resetZoneSync();
  window.localStorage.clear();
});

describe("shell data refresh", () => {
  it("fetches once, then again when a session is logged, keeping the old numbers meanwhile", async () => {
    vi.mocked(getMe).mockResolvedValue({ id: 1, username: "u", email: "u@example.com", time_zone: null, time_zone_auto: false });
    vi.mocked(listPlans).mockResolvedValue([]);
    vi.mocked(getSessionHistory).mockResolvedValueOnce({ items: [session(60)] });

    const { container, unmount } = await render(
      <ShellDataProvider>
        <Suspense fallback={<p>loading</p>}>
          <Logged />
        </Suspense>
      </ShellDataProvider>,
    );
    expect(container.textContent).toBe("1 h from 1 sessions");
    expect(getSessionHistory).toHaveBeenCalledTimes(1);

    let resolve!: (value: { items: SessionHistoryItem[] }) => void;
    vi.mocked(getSessionHistory).mockReturnValueOnce(new Promise((done) => (resolve = done)));
    await act(async () => notifySessionsChanged());
    // A transition: the old view stays instead of the Suspense fallback.
    expect(container.textContent).toBe("1 h from 1 sessions");

    await act(async () => resolve({ items: [session(60), session(30)] }));
    expect(container.textContent).toBe("1.5 h from 2 sessions");
    expect(getSessionHistory).toHaveBeenCalledTimes(2);
    unmount();
  });
});

function Zone() {
  return <p>{useTimeZone()}</p>;
}

describe("the account's time zone", () => {
  const deviceIs = (name: string) =>
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: name } as unknown as Intl.ResolvedDateTimeFormatOptions);

  it("is published to the pages and remembered", async () => {
    deviceIs("Asia/Tokyo");
    vi.mocked(getMe).mockResolvedValue({ id: 1, username: "u", email: "u@example.com", time_zone: "Africa/Lagos", time_zone_auto: false });
    vi.mocked(listPlans).mockResolvedValue([]);
    vi.mocked(getSessionHistory).mockResolvedValue({ items: [] });
    const { container, unmount } = await render(
      <ShellDataProvider>
        <Zone />
      </ShellDataProvider>,
    );
    expect(container.textContent).toBe("Africa/Lagos");
    expect(window.localStorage.getItem("studypilot_last_zone")).toBe("Africa/Lagos");
    expect(setTimeZone).not.toHaveBeenCalled();
    unmount();
  });

  it("follows the device: one PUT when the shell loads, then the shell fetches the account again", async () => {
    deviceIs("Asia/Tokyo");
    const lagos = { id: 1, username: "u", email: "u@example.com", time_zone: "Africa/Lagos", time_zone_auto: true };
    vi.mocked(getMe).mockResolvedValueOnce(lagos).mockResolvedValue({ ...lagos, time_zone: "Asia/Tokyo" });
    vi.mocked(listPlans).mockResolvedValue([]);
    vi.mocked(getSessionHistory).mockResolvedValue({ items: [] });
    vi.mocked(setTimeZone).mockResolvedValue({ ...lagos, time_zone: "Asia/Tokyo" });
    const { container, unmount } = await render(
      <ShellDataProvider>
        <Zone />
      </ShellDataProvider>,
    );
    await act(async () => undefined);
    expect(setTimeZone).toHaveBeenCalledTimes(1);
    expect(setTimeZone).toHaveBeenCalledWith("Asia/Tokyo", true);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("Asia/Tokyo");
    unmount();
  });
});
