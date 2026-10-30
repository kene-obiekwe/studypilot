// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { getAccessToken, hasSession, setSession, clearSession } from "./session";
import { lastKnownZone, lastSyncedZone, rememberSyncedZone, rememberZone } from "./zone";

beforeEach(() => {
  window.localStorage.clear();
});

describe("clearSession", () => {
  it("drops the tokens and forgets the zone, which is not per user", () => {
    setSession({ access: "a", refresh: "r" });
    rememberZone("Asia/Tokyo");
    rememberSyncedZone("Asia/Tokyo");
    expect(hasSession()).toBe(true);

    clearSession();

    expect(hasSession()).toBe(false);
    expect(getAccessToken()).toBe("");
    expect(lastKnownZone()).toBeNull();
    expect(lastSyncedZone()).toBeNull();
  });
});
