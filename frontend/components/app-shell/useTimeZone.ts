"use client";

import { createContext, useContext } from "react";

import { effectiveZone } from "@/lib/zone";

/**
 * The zone that decides days and weeks for the signed-in user (`effectiveZone(me)`), set by
 * ShellDataProvider once the account has loaded. Null outside the provider and before it resolves.
 */
export const TimeZoneContext = createContext<string | null>(null);

/**
 * The zone to pass to every day/week function. It does not suspend: before the account has loaded
 * (or outside the workspace shell) it is `effectiveZone(undefined)`, the last-known zone, then the browser's.
 */
export function useTimeZone(): string {
  const zone = useContext(TimeZoneContext);
  return zone ?? effectiveZone(undefined);
}
