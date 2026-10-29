// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render } from "@/test/dom";

import { TIMER_STORAGE_KEY, type TimerState } from "./timer";
import { clearTimer, getTimerSnapshot, startTimer, subscribeTimer, useNow, useStoredTimer } from "./timer-store";

const TIMER: TimerState = { userId: 1, courseId: 3, courseName: "Calculus", startedAt: 1_000, plannedMinutes: 45 };

afterEach(() => {
  clearTimer();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("timer store", () => {
  it("persists to localStorage and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimer(listener);
    startTimer(TIMER);
    expect(JSON.parse(window.localStorage.getItem(TIMER_STORAGE_KEY)!)).toEqual(TIMER);
    expect(listener).toHaveBeenCalledTimes(1);
    clearTimer();
    expect(window.localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("hears another tab through the storage event", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimer(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: TIMER_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("keeps working in memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    startTimer(TIMER);
    expect(getTimerSnapshot()).toBe(JSON.stringify(TIMER));
  });

  it("renders the stored timer and follows changes", async () => {
    function Probe() {
      const timer = useStoredTimer();
      return <p>{timer ? timer.courseName : "none"}</p>;
    }
    const { container, unmount } = await render(<Probe />);
    expect(container.textContent).toBe("none");
    await act(async () => startTimer(TIMER));
    expect(container.textContent).toBe("Calculus");
    await act(async () => clearTimer());
    expect(container.textContent).toBe("none");
    unmount();
  });

  it("ticks once a second, and not while the tab is hidden", async () => {
    vi.useFakeTimers({ now: 10_000 });
    function Clock() {
      return <p>{useNow()}</p>;
    }
    const { container, unmount } = await render(<Clock />);
    expect(container.textContent).toBe("10000");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(container.textContent).toBe("11000");

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTime(3000));
    expect(container.textContent).toBe("11000");

    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.textContent).toBe("14000");
    unmount();
  });
});
