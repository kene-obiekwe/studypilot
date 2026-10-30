/**
 * Time zones and calendar-date keys.
 *
 * Days and weeks are decided in the user's zone, not the browser's: the account stores a zone and
 * both sides use it. Everything here works on YYYY-MM-DD "date keys" and compares keys, never
 * instants, so a week that is 167 or 169 hours long (DST) needs no special case. Key arithmetic is
 * done with Date.UTC, which has no daylight saving, and never with the local Date constructors.
 */

import type { Me } from "./api";

const LAST_ZONE_KEY = "studypilot_last_zone";
const SYNCED_ZONE_KEY = "studypilot_synced_zone";

// -- Which zone ----------------------------------------------------------------------------------

/** The browser's IANA zone, or null when it reports none. */
export function browserZone(): string | null {
  try {
    const name = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(zone, formatter);
  }
  return formatter;
}

/** True when this browser's Intl knows the zone name. */
export function isSupportedZone(name: string): boolean {
  if (typeof name !== "string" || !name) return false;
  try {
    dayFormatter(name);
    return true;
  } catch {
    return false;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Storage can be full, blocked or private; the zone is then just not remembered.
  }
}

/** The zone this browser last used for the signed-in user, if it is still a name Intl accepts. */
export function lastKnownZone(): string | null {
  const name = readStored(LAST_ZONE_KEY);
  return name && isSupportedZone(name) ? name : null;
}

export function rememberZone(name: string): void {
  writeStored(LAST_ZONE_KEY, name);
}

/** The zone this browser last sent to the server successfully. */
export function lastSyncedZone(): string | null {
  return readStored(SYNCED_ZONE_KEY);
}

export function rememberSyncedZone(name: string): void {
  writeStored(SYNCED_ZONE_KEY, name);
}

/**
 * Sign-out: forget both. The synced zone goes too, otherwise the next account on this browser would
 * never get its first sync (the browser zone would equal the last one synced for the previous user).
 */
export function forgetZone(): void {
  try {
    const store = storage();
    store?.removeItem(LAST_ZONE_KEY);
    store?.removeItem(SYNCED_ZONE_KEY);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

/**
 * The zone to decide days and weeks in.
 * - The account's zone, when it has one this browser's Intl accepts.
 * - Never set (null): the browser zone, not UTC. The server treats an unset zone as UTC until the
 *   first sync lands, but the client has no reason to.
 * - Not loaded yet (no `me`) or a zone Intl rejects: the last-known zone, then the browser's.
 * - "UTC" only when nothing else exists.
 */
export function effectiveZone(me?: Pick<Me, "time_zone"> | null): string {
  const stored = me?.time_zone;
  if (typeof stored === "string" && isSupportedZone(stored)) return stored;
  if (stored === null) return browserZone() ?? lastKnownZone() ?? "UTC";
  return lastKnownZone() ?? browserZone() ?? "UTC";
}

/** The zone a function uses when it is not given one: the browser's. */
export function resolveZone(zone?: string): string {
  return zone ?? browserZone() ?? "UTC";
}

/**
 * Auto-sync: send the browser zone to the server only when the account follows the device, the browser
 * reports a zone, it differs from the stored one, and it is not the one this browser already sent
 * (two devices in different zones would otherwise flip the account on every load).
 */
export function shouldSyncZone(input: {
  auto: boolean;
  stored: string | null;
  browser: string | null;
  lastSynced: string | null;
}): boolean {
  const { auto, stored, browser, lastSynced } = input;
  return auto && browser !== null && browser !== stored && browser !== lastSynced;
}

// -- Date keys -----------------------------------------------------------------------------------

/** YYYY-MM-DD of an instant in `zone`. */
export function dateKeyIn(instant: Date | number, zone: string): string {
  const parts = dayFormatter(zone).formatToParts(instant);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function parseKey(key: string): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number);
  return [year, month, day];
}

function keyOfUtc(ms: number): string {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The key `n` calendar days after (or, negative, before) `key`. */
export function addDays(key: string, n: number): string {
  const [year, month, day] = parseKey(key);
  return keyOfUtc(Date.UTC(year, month - 1, day + n));
}

/** Monday = 0 … Sunday = 6, the same numbering lib/week.ts and the planner use. */
export function weekdayOf(key: string): number {
  const [year, month, day] = parseKey(key);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `key`. */
export function mondayOf(key: string): string {
  return addDays(key, -weekdayOf(key));
}

/** Today's key in `zone`. */
export function todayKey(zone: string, now: Date = new Date()): string {
  return dateKeyIn(now, zone);
}

/** Whole days from key `a` to key `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parseKey(a);
  const [by, bm, bd] = parseKey(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// -- Start of a day, as an instant ---------------------------------------------------------------

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = clockFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    clockFormatters.set(zone, formatter);
  }
  return formatter;
}

/** The zone's offset from UTC at an instant, in milliseconds (Lagos: +3_600_000). */
function offsetAt(ms: number, zone: string): number {
  const parts = clockFormatter(zone).formatToParts(ms);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a day starts in `zone` (its 00:00). Where midnight does not exist or happens twice
 * (some zones change clocks at 00:00) this is the earlier reading, like Python's fold=0. Nothing in
 * the week logic depends on it: it exists for callers that need a Date.
 */
export function dayStartIn(key: string, zone: string): Date {
  const [year, month, day] = parseKey(key);
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, zone);
  const firstOffset = offsetAt(first, zone);
  if (guess - firstOffset === first) return new Date(first);
  // The offset changed between the guess and midnight: try the offset midnight really has.
  const second = guess - firstOffset;
  if (offsetAt(second, zone) === firstOffset) return new Date(second);
  // Midnight does not exist (clocks jump over it): the instant the clocks jump.
  return new Date(first);
}
