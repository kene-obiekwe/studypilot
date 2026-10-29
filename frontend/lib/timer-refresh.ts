/**
 * "Sessions changed": after a session is logged anywhere (the timer or the log page), the shell
 * meter and the home page re-fetch without a page reload. Other tabs hear it through a
 * localStorage `storage` event on SESSIONS_CHANGED_KEY.
 */

import { logSession, type SessionLogPayload, type SessionLogResponse } from "./api";

export const SESSIONS_CHANGED_KEY = "sp-sessions-changed";

type Listener = () => void;

const listeners = new Set<Listener>();

function onStorage(event: StorageEvent) {
  if (event.key === SESSIONS_CHANGED_KEY) listeners.forEach((listener) => listener());
}

/** Calls `listener` whenever sessions change, in this tab or another. Returns the unsubscribe. */
export function onSessionsChanged(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function notifySessionsChanged(now: () => number = Date.now) {
  try {
    // A new value each time, so other tabs always get a storage event.
    window.localStorage.setItem(SESSIONS_CHANGED_KEY, String(now()));
  } catch {
    // Other tabs won't hear about it; this tab still refreshes.
  }
  listeners.forEach((listener) => listener());
}

/** Logs a session, then tells the meter and home to refresh. Errors propagate and notify nobody. */
export async function logStudySession(payload: SessionLogPayload): Promise<SessionLogResponse> {
  const response = await logSession(payload);
  notifySessionsChanged();
  return response;
}
