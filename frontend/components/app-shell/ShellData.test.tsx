// @vitest-environment jsdom
import { act, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMe, getSessionHistory, listPlans, type SessionHistoryItem } from "@/lib/api";
import { notifySessionsChanged } from "@/lib/timer-refresh";
import { render } from "@/test/dom";

import { ShellDataProvider, useShellData } from "./ShellData";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMe: vi.fn(),
  listPlans: vi.fn(),
  getSessionHistory: vi.fn(),
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
  vi.clearAllMocks();
});

describe("shell data refresh", () => {
  it("fetches once, then again when a session is logged, keeping the old numbers meanwhile", async () => {
    vi.mocked(getMe).mockResolvedValue({ id: 1, username: "u", email: "u@example.com" });
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
