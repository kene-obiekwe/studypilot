// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { logSession } from "./api";
import { logStudySession, notifySessionsChanged, onSessionsChanged, SESSIONS_CHANGED_KEY } from "./timer-refresh";

const PAYLOAD = { course_name: "Calculus", planned_minutes: 50, actual_minutes: 45, focus_score: 0.8, completion_rate: 0.75 };

vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), logSession: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sessions-changed signal", () => {
  it("notifies this tab and writes a new value for other tabs", () => {
    const listener = vi.fn();
    const unsubscribe = onSessionsChanged(listener);
    notifySessionsChanged(() => 111);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SESSIONS_CHANGED_KEY)).toBe("111");
    unsubscribe();
    notifySessionsChanged(() => 222);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hears another tab's change", () => {
    const listener = vi.fn();
    const unsubscribe = onSessionsChanged(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: SESSIONS_CHANGED_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: "sp-timer" }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("still notifies this tab when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const listener = vi.fn();
    const unsubscribe = onSessionsChanged(listener);
    notifySessionsChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("is sent after a successful log, and not after a failed one", async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionsChanged(listener);
    const response = { message: "ok", computed: { adherence: 0.9, predicted_adherence: 0.8, model_version: "v", focus_score: 0.8, completion_rate: 0.75 } };
    const log = vi.mocked(logSession).mockResolvedValueOnce(response);
    await expect(logStudySession(PAYLOAD)).resolves.toEqual(response);
    expect(log).toHaveBeenCalledWith(PAYLOAD);
    expect(listener).toHaveBeenCalledTimes(1);

    log.mockRejectedValueOnce(new Error("Course not found."));
    await expect(logStudySession(PAYLOAD)).rejects.toThrow("Course not found.");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
