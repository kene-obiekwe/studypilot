import { ApiError, getMe, setTimeZone, type Me } from "@/lib/api";
import { browserZone, lastSyncedZone, rememberSyncedZone, rememberZone, shouldSyncZone } from "@/lib/zone";

/** The PUT in flight, if any: at most one at a time, however many callers ask. */
let inFlight: Promise<boolean> | null = null;

const syncedListeners = new Set<() => void>();

/** Called after any sync the server accepted, so the shell can fetch the account again. Returns the unsubscribe. */
export function onZoneSynced(listener: () => void): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}

/** True when the server answered 400 with a message about `time_zone`: it will never accept this name. */
function rejectedByServer(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && Boolean(error.fieldErrors.time_zone);
}

/**
 * Follow the device: send the browser zone when the account asks for it and it differs from what the
 * server has (see shouldSyncZone). Silent, never rejects. Resolves true when the server took the zone.
 *
 * - 200: the zone and the fact that it was sent are remembered.
 * - 400 about time_zone: the name is remembered as sent too, so a name the server rejects is not retried.
 * - Anything else (network, 404 while Render is still on the old backend, 429, 5xx): nothing is
 *   remembered, so the next load tries again.
 */
export function syncTimeZone(me: Me | null | undefined): Promise<boolean> {
  if (inFlight) return inFlight;
  if (!me) return Promise.resolve(false);
  const browser = browserZone();
  const stored = me.time_zone ?? null;
  if (!shouldSyncZone({ auto: me.time_zone_auto, stored, browser, lastSynced: lastSyncedZone() }) || browser === null) {
    return Promise.resolve(false);
  }
  inFlight = setTimeZone(browser, true).then(
    () => {
      rememberSyncedZone(browser);
      rememberZone(browser);
      syncedListeners.forEach((listener) => listener());
      return true;
    },
    (error: unknown) => {
      if (rejectedByServer(error)) rememberSyncedZone(browser);
      return false;
    },
  ).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Right after sign-in or email verification, before the shell exists: look the account up, then sync. */
export async function syncTimeZoneAfterSignIn(): Promise<boolean> {
  try {
    return await syncTimeZone(await getMe());
  } catch {
    return false;
  }
}

/** Test helper: forget a PUT left in flight. */
export function resetZoneSync(): void {
  inFlight = null;
}
