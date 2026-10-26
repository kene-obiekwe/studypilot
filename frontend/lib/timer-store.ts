/**
 * The running timer, kept in localStorage so it survives a refresh and is shared across tabs
 * (other tabs hear about changes through the `storage` event). Read it with useSyncExternalStore:
 * the snapshot is the raw string, which is stable between changes.
 *
 * Storage can be unavailable (private windows, blocked site data): every access is wrapped, and
 * an in-memory copy keeps the timer working in this tab.
 */

import { useMemo, useSyncExternalStore } from "react";

import { parseTimer, serializeTimer, TIMER_STORAGE_KEY, type TimerState } from "./timer";

type Listener = () => void;

const listeners = new Set<Listener>();
let memory: string | null = null;

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(TIMER_STORAGE_KEY);
  } catch {
    return memory;
  }
}

function writeStorage(value: string | null) {
  memory = value;
  try {
    if (value === null) {
      window.localStorage.removeItem(TIMER_STORAGE_KEY);
    } else {
      window.localStorage.setItem(TIMER_STORAGE_KEY, value);
    }
  } catch {
    // Kept in memory for this tab only.
  }
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  // key is null when another tab cleared all storage.
  if (event.key === TIMER_STORAGE_KEY || event.key === null) {
    listeners.forEach((listener) => listener());
  }
}

export function subscribeTimer(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getTimerSnapshot(): string | null {
  return readStorage();
}

export function startTimer(state: TimerState) {
  writeStorage(serializeTimer(state));
}

export function clearTimer() {
  writeStorage(null);
}

/** The stored timer (any user's; filter with timerForUser). Null on the server. */
export function useStoredTimer(): TimerState | null {
  const raw = useSyncExternalStore(subscribeTimer, getTimerSnapshot, () => null);
  return useMemo(() => parseTimer(raw), [raw]);
}

// -- A one-second clock that sleeps while the tab is hidden ---------------------------------

const clockListeners = new Set<Listener>();
let clockNow = 0;
let interval: ReturnType<typeof setInterval> | null = null;

function tick() {
  if (document.visibilityState === "hidden") return;
  clockNow = Date.now();
  clockListeners.forEach((listener) => listener());
}

function subscribeClock(listener: Listener): () => void {
  clockListeners.add(listener);
  if (clockListeners.size === 1) {
    clockNow = Date.now();
    interval = setInterval(tick, 1000);
    // Coming back to the tab updates at once instead of waiting for the next tick.
    document.addEventListener("visibilitychange", tick);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      if (interval !== null) clearInterval(interval);
      interval = null;
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

function getClockSnapshot(): number {
  // Must return the same value until a tick; subscribing refreshes it (React re-reads after subscribe).
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/** Date.now(), refreshed once a second while mounted and visible. 0 on the server. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, getClockSnapshot, () => 0);
}
