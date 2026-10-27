// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { cleanup, flush, render } from "@/test/dom";

const api = vi.hoisted(() => ({
  getPlanHistory: vi.fn(),
  getSessionHistory: vi.fn(),
  getTrainingData: vi.fn(),
}));
const session = vi.hoisted(() => ({ hasSession: vi.fn() }));

vi.mock("@/lib/api", () => api);
vi.mock("@/lib/session", () => session);

import { notifySessionsChanged } from "@/lib/timer-refresh";

import { ProgressProvider, useProgress } from "./shared";

function Probe() {
  const { sessions } = useProgress();
  return <p>{sessions.length} sessions</p>;
}

beforeEach(() => {
  api.getPlanHistory.mockReset().mockResolvedValue({ items: [] });
  api.getSessionHistory.mockReset().mockResolvedValue({ items: [] });
  api.getTrainingData.mockReset().mockResolvedValue({ rows: [] });
  session.hasSession.mockReset().mockReturnValue(true);
});

afterEach(cleanup);

describe("ProgressProvider", () => {
  it("loads the history once on mount", async () => {
    await render(
      <ProgressProvider>
        <Probe />
      </ProgressProvider>,
    );
    await flush();
    expect(api.getSessionHistory).toHaveBeenCalledTimes(1);
  });

  it("refreshes when a session is saved elsewhere (the timer)", async () => {
    const view = await render(
      <ProgressProvider>
        <Probe />
      </ProgressProvider>,
    );
    await flush();
    expect(api.getSessionHistory).toHaveBeenCalledTimes(1);

    api.getSessionHistory.mockResolvedValue({ items: [{ id: 1, actual_minutes: 30, planned_minutes: 30, adherence_score: 1, focus_score: 1, completion_rate: 1, predicted_adherence: null, course_name: "MTH 210", model_version: "", created_at: "2026-10-26T10:00:00Z" }] });
    await act(async () => {
      notifySessionsChanged();
    });
    await flush();

    expect(api.getSessionHistory).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe("1 sessions");
  });

  it("stops listening once unmounted", async () => {
    const view = await render(
      <ProgressProvider>
        <Probe />
      </ProgressProvider>,
    );
    await flush();
    view.unmount();
    await act(async () => {
      notifySessionsChanged();
    });
    expect(api.getSessionHistory).toHaveBeenCalledTimes(1);
  });

  it("does not fetch for a signed-out visitor", async () => {
    session.hasSession.mockReturnValue(false);
    await render(
      <ProgressProvider>
        <Probe />
      </ProgressProvider>,
    );
    await act(async () => {
      notifySessionsChanged();
    });
    expect(api.getSessionHistory).not.toHaveBeenCalled();
  });
});
