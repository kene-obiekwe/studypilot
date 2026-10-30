import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Me } from "./api";
import {
  addDays,
  browserZone,
  dateKeyIn,
  daysBetween,
  dayStartIn,
  effectiveZone,
  forgetZone,
  isSupportedZone,
  lastKnownZone,
  lastSyncedZone,
  mondayOf,
  rememberSyncedZone,
  rememberZone,
  resolveZone,
  shouldSyncZone,
  todayKey,
  weekdayOf,
} from "./zone";

// Every instant is an ISO string with an offset and every zone is explicit, so these tests mean the
// same on any machine.
const instant = (iso: string) => new Date(iso);

const LAGOS = "Africa/Lagos";
const LA = "America/Los_Angeles";
const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";
const KIRITIMATI = "Pacific/Kiritimati";
const MINUS_12 = "Etc/GMT+12";

const keyAndMonday = (iso: string, zone: string) => {
  const key = dateKeyIn(instant(iso), zone);
  return [key, mondayOf(key)];
};

describe("date keys and the week's Monday", () => {
  it("Lagos: Sunday 1 Nov 23:30Z is already Monday 2 Nov", () => {
    expect(keyAndMonday("2026-11-01T23:30:00Z", LAGOS)).toEqual(["2026-11-02", "2026-11-02"]);
    expect(keyAndMonday("2026-11-01T22:59:00Z", LAGOS)).toEqual(["2026-11-01", "2026-10-26"]);
  });

  it("Los Angeles: Monday 26 Oct 02:00Z is still Sunday 25 Oct, week of 19 Oct", () => {
    expect(keyAndMonday("2026-10-26T02:00:00Z", LA)).toEqual(["2026-10-25", "2026-10-19"]);
  });

  it("London, BST ending (a 169 hour week): Sunday night is still the week of 19 Oct", () => {
    expect(keyAndMonday("2026-10-18T23:30:00+00:00", LONDON)).toEqual(["2026-10-19", "2026-10-19"]); // Monday 00:30 BST
    expect(keyAndMonday("2026-10-25T23:30:00Z", LONDON)).toEqual(["2026-10-25", "2026-10-19"]); // Sunday 23:30 GMT
    expect(keyAndMonday("2026-10-26T00:30:00Z", LONDON)).toEqual(["2026-10-26", "2026-10-26"]);
  });

  it("London, BST starting (a 167 hour week): the Sunday night hour is not lost", () => {
    expect(keyAndMonday("2026-03-29T22:30:00Z", LONDON)).toEqual(["2026-03-29", "2026-03-23"]); // Sunday 23:30 BST
    expect(keyAndMonday("2026-03-29T23:30:00Z", LONDON)).toEqual(["2026-03-30", "2026-03-30"]); // Monday 00:30 BST
  });

  it("New York, DST ending: 04:30Z is Sunday 23:30 EST, 05:30Z is Monday", () => {
    expect(keyAndMonday("2026-11-02T04:30:00Z", NEW_YORK)).toEqual(["2026-11-01", "2026-10-26"]);
    expect(keyAndMonday("2026-11-02T05:30:00Z", NEW_YORK)).toEqual(["2026-11-02", "2026-11-02"]);
  });

  it("Kiritimati (UTC+14): Sunday 1 Nov 10:30Z is already Monday 2 Nov", () => {
    expect(keyAndMonday("2026-11-01T10:30:00Z", KIRITIMATI)).toEqual(["2026-11-02", "2026-11-02"]);
  });

  it("Etc/GMT+12 (UTC-12): Monday 26 Oct 11:00Z is still Sunday 25 Oct", () => {
    expect(keyAndMonday("2026-10-26T11:00:00Z", MINUS_12)).toEqual(["2026-10-25", "2026-10-19"]);
  });

  it("todayKey uses the zone and the given clock", () => {
    expect(todayKey(LAGOS, instant("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
    expect(todayKey(LA, instant("2026-11-01T23:30:00Z"))).toBe("2026-11-01");
  });

  it("accepts epoch milliseconds as the instant", () => {
    expect(dateKeyIn(Date.parse("2026-11-01T23:30:00Z"), LAGOS)).toBe("2026-11-02");
  });
});

describe("key arithmetic", () => {
  it("adds and subtracts days across month, year and leap-day edges", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-19", 7)).toBe("2026-10-26");
    expect(addDays("2026-10-19", 0)).toBe("2026-10-19");
  });

  it("is not affected by DST dates in any zone", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("numbers weekdays Monday = 0 to Sunday = 6, like lib/week.ts", () => {
    expect(weekdayOf("2026-10-19")).toBe(0);
    expect(weekdayOf("2026-10-22")).toBe(3);
    expect(weekdayOf("2026-10-25")).toBe(6);
  });

  it("finds the Monday of any day of the week, including across a year end", () => {
    for (const day of ["2026-10-19", "2026-10-21", "2026-10-25"]) expect(mondayOf(day)).toBe("2026-10-19");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("counts days between keys, negative when earlier", () => {
    expect(daysBetween("2026-10-19", "2026-10-26")).toBe(7);
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(0);
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(-2);
  });
});

describe("the start of a day, as an instant", () => {
  const start = (key: string, zone: string) => dayStartIn(key, zone).toISOString();

  it("is local midnight in the zone", () => {
    expect(start("2026-11-02", LAGOS)).toBe("2026-11-01T23:00:00.000Z");
    expect(start("2026-10-26", LA)).toBe("2026-10-26T07:00:00.000Z");
    expect(start("2026-11-02", KIRITIMATI)).toBe("2026-11-01T10:00:00.000Z");
    expect(start("2026-10-26", MINUS_12)).toBe("2026-10-26T12:00:00.000Z");
  });

  it("follows the offset each Monday really has (169 and 167 hour weeks)", () => {
    expect(start("2026-10-19", LONDON)).toBe("2026-10-18T23:00:00.000Z"); // BST
    expect(start("2026-10-26", LONDON)).toBe("2026-10-26T00:00:00.000Z"); // GMT
    expect(start("2026-03-23", LONDON)).toBe("2026-03-23T00:00:00.000Z");
    expect(start("2026-03-30", LONDON)).toBe("2026-03-29T23:00:00.000Z");
  });

  it("takes the transition instant when midnight does not exist", () => {
    // Chile jumps 00:00 -> 01:00 on Sunday 6 Sep 2026: the day starts when the clocks jump.
    expect(start("2026-09-06", "America/Santiago")).toBe("2026-09-06T04:00:00.000Z");
  });
});

describe("zone names", () => {
  it("accepts IANA names and aliases, rejects the rest", () => {
    expect(isSupportedZone(LAGOS)).toBe(true);
    expect(isSupportedZone("UTC")).toBe(true);
    expect(isSupportedZone("Mars/Olympus")).toBe(false);
    expect(isSupportedZone("")).toBe(false);
  });

  it("reads the browser zone and returns null when Intl reports none", () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
    spy.mockReturnValue({ timeZone: "Asia/Tokyo" } as Intl.ResolvedDateTimeFormatOptions);
    expect(browserZone()).toBe("Asia/Tokyo");
    spy.mockReturnValue({ timeZone: undefined } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(browserZone()).toBeNull();
    spy.mockImplementation(() => {
      throw new Error("no Intl");
    });
    expect(browserZone()).toBeNull();
    spy.mockRestore();
  });

  it("resolves an omitted zone to the browser's, then UTC", () => {
    expect(resolveZone(LAGOS)).toBe(LAGOS);
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
    spy.mockReturnValue({ timeZone: "Asia/Tokyo" } as Intl.ResolvedDateTimeFormatOptions);
    expect(resolveZone()).toBe("Asia/Tokyo");
    spy.mockReturnValue({ timeZone: undefined } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(resolveZone()).toBe("UTC");
    spy.mockRestore();
  });
});

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const stubBrowserZone = (name: string | undefined) =>
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: name } as unknown as Intl.ResolvedDateTimeFormatOptions);

describe("effectiveZone", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the account's zone when Intl accepts it", () => {
    stubBrowserZone("Asia/Tokyo");
    rememberZone(NEW_YORK);
    expect(effectiveZone({ time_zone: LAGOS })).toBe(LAGOS);
  });

  it("uses the browser zone, not UTC, when the account has never set one", () => {
    stubBrowserZone("Asia/Tokyo");
    rememberZone(NEW_YORK);
    expect(effectiveZone({ time_zone: null })).toBe("Asia/Tokyo");
  });

  it("falls back from an unsupported zone to last-known, then the browser, then UTC", () => {
    const spy = stubBrowserZone("Asia/Tokyo");
    rememberZone(NEW_YORK);
    expect(effectiveZone({ time_zone: "Mars/Olympus" })).toBe(NEW_YORK);
    forgetZone();
    expect(effectiveZone({ time_zone: "Mars/Olympus" })).toBe("Asia/Tokyo");
    spy.mockReturnValue({ timeZone: undefined } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(effectiveZone({ time_zone: "Mars/Olympus" })).toBe("UTC");
  });

  it("uses the last-known zone while the account has not loaded", () => {
    stubBrowserZone("Asia/Tokyo");
    expect(effectiveZone()).toBe("Asia/Tokyo");
    rememberZone(NEW_YORK);
    expect(effectiveZone()).toBe(NEW_YORK);
    expect(effectiveZone(null)).toBe(NEW_YORK);
    // An account from a backend that predates the field has no time_zone key at all.
    expect(effectiveZone({} as Pick<Me, "time_zone">)).toBe(NEW_YORK);
  });

  it("ignores a remembered zone Intl no longer accepts", () => {
    stubBrowserZone("Asia/Tokyo");
    rememberZone("Mars/Olympus");
    expect(lastKnownZone()).toBeNull();
    expect(effectiveZone()).toBe("Asia/Tokyo");
  });

  it("is UTC only when the account is unset and the browser reports nothing", () => {
    stubBrowserZone(undefined);
    expect(effectiveZone({ time_zone: null })).toBe("UTC");
  });
});

describe("remembered zones", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("remembers the last-known and last-synced zones, and forgets both", () => {
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    expect([lastKnownZone(), lastSyncedZone()]).toEqual([null, null]);
    rememberZone(LAGOS);
    rememberSyncedZone(LA);
    expect([lastKnownZone(), lastSyncedZone()]).toEqual([LAGOS, LA]);
    forgetZone();
    expect([lastKnownZone(), lastSyncedZone()]).toEqual([null, null]);
  });

  it("does nothing without a window (server render)", () => {
    expect(() => {
      rememberZone(LAGOS);
      rememberSyncedZone(LAGOS);
      forgetZone();
    }).not.toThrow();
    expect([lastKnownZone(), lastSyncedZone()]).toEqual([null, null]);
  });

  it("survives a localStorage that throws on every call", () => {
    const boom = () => {
      throw new Error("storage blocked");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(() => {
      rememberZone(LAGOS);
      rememberSyncedZone(LAGOS);
      forgetZone();
    }).not.toThrow();
    expect([lastKnownZone(), lastSyncedZone()]).toEqual([null, null]);
    stubBrowserZone("Asia/Tokyo");
    expect(effectiveZone()).toBe("Asia/Tokyo");
  });

  it("survives a window whose localStorage getter throws", () => {
    const blocked = {};
    Object.defineProperty(blocked, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    vi.stubGlobal("window", blocked);
    expect(() => {
      rememberZone(LAGOS);
      forgetZone();
    }).not.toThrow();
    expect(lastKnownZone()).toBeNull();
    expect(lastSyncedZone()).toBeNull();
  });
});

describe("shouldSyncZone", () => {
  const base = { auto: true, stored: LAGOS, browser: LA, lastSynced: null as string | null };

  it("syncs when auto is on and the browser zone is new", () => {
    expect(shouldSyncZone(base)).toBe(true);
  });

  it("syncs a first-ever zone (nothing stored)", () => {
    expect(shouldSyncZone({ ...base, stored: null })).toBe(true);
  });

  it("never syncs in manual mode", () => {
    expect(shouldSyncZone({ ...base, auto: false })).toBe(false);
    expect(shouldSyncZone({ ...base, auto: false, stored: null })).toBe(false);
  });

  it("never syncs when the browser reports no zone", () => {
    expect(shouldSyncZone({ ...base, browser: null })).toBe(false);
    expect(shouldSyncZone({ ...base, browser: null, stored: null })).toBe(false);
  });

  it("does not sync when the browser zone already is the stored one", () => {
    expect(shouldSyncZone({ ...base, browser: LAGOS })).toBe(false);
  });

  it("does not sync a zone this browser already sent (two devices must not flip the account)", () => {
    expect(shouldSyncZone({ ...base, lastSynced: LA })).toBe(false);
    expect(shouldSyncZone({ ...base, lastSynced: NEW_YORK })).toBe(true);
  });

  it("covers the whole truth table", () => {
    const zones = [null, LAGOS, LA];
    for (const auto of [true, false]) {
      for (const stored of zones) {
        for (const browser of zones) {
          for (const lastSynced of zones) {
            const expected = auto && browser !== null && browser !== stored && browser !== lastSynced;
            expect(shouldSyncZone({ auto, stored, browser, lastSynced })).toBe(expected);
          }
        }
      }
    }
  });
});
