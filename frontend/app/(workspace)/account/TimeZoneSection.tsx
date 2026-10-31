"use client";

import { useId, useMemo, useState, type FormEvent } from "react";

import { useRefreshShellData } from "@/components/app-shell/ShellData";
import { Button, Card, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { ApiError, setTimeZone, type Me } from "@/lib/api";
import { browserZone, effectiveZone, rememberSyncedZone, rememberZone } from "@/lib/zone";

import styles from "./account.module.css";

/** Every zone this browser knows, or null when it cannot list them (then the section asks for a name). */
export function supportedZones(): string[] | null {
  try {
    const list = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    return list && list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

export const FOLLOW_HINT = "Following your device updates your week when you travel.";

type Props = { me: Me };

/**
 * The zone that decides your days and weeks. By default it follows this device; picking a zone by
 * hand stops that. When following is off and the device is somewhere else, a notice offers a one-click switch back.
 */
export function TimeZoneSection({ me }: Props) {
  const titleId = useId();
  const refresh = useRefreshShellData();
  const zone = effectiveZone(me);
  const device = browserZone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");

  const zones = useMemo(() => {
    const list = supportedZones();
    if (!list) return null;
    // Some browsers leave UTC out of the list; the current zone may be one of those or an alias.
    return [...new Set([...list, "UTC", zone])].sort();
  }, [zone]);
  const matches = useMemo(() => {
    if (!zones) return [];
    const needle = search.trim().toLowerCase().replace(/\s+/g, "_");
    return needle ? zones.filter((name) => name.toLowerCase().includes(needle)) : zones;
  }, [zones, search]);

  /** Sends the change; on success remembers it and refreshes the shell so every page uses the new week. */
  const change = async (name: string, auto: boolean): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const updated = await setTimeZone(name, auto);
      const stored = updated.time_zone ?? name;
      rememberZone(stored);
      rememberSyncedZone(name);
      refresh();
      return true;
    } catch (failure) {
      const problem = failure instanceof ApiError ? failure.fieldErrors.time_zone?.[0] : undefined;
      setError(problem ?? (failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onFollowChange = (follow: boolean) => {
    if (follow && device) void change(device, true);
    // Turning it off keeps the zone you have now.
    else if (!follow) void change(zone, false);
  };

  const onTypedSubmit = (event: FormEvent) => {
    event.preventDefault();
    const name = typed.trim();
    if (!name) {
      setError("Enter a time zone, such as Africa/Lagos.");
      return;
    }
    void change(name, false).then((saved) => saved && setTyped(""));
  };

  const mismatch = !me.time_zone_auto && device !== null && device !== zone;

  return (
    <Card as="section" className={styles.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Time zone
      </h2>
      <p className={styles.zoneLine}>
        <strong>{zone}</strong> · {me.time_zone_auto ? "Follows this device" : "Set by you"}
      </p>
      <p className={styles.sectionLede}>StudyPilot uses it to decide what day it is and when your week starts.</p>

      <Checkbox
        label="Use this device's time zone"
        hint={FOLLOW_HINT}
        checked={me.time_zone_auto}
        disabled={busy || device === null}
        onChange={(event) => onFollowChange(event.target.checked)}
      />

      {mismatch && (
        <Notice tone="info">
          <div className={styles.stack}>
            <span>
              This device is on {device}; StudyPilot uses {zone}.
            </span>
            <div className={styles.actions}>
              <Button size="sm" loading={busy} onClick={() => void change(device, true)}>
                Switch to {device}
              </Button>
            </div>
          </div>
        </Notice>
      )}

      {zones ? (
        <div className={styles.form}>
          <Field label="Search time zones" hint="Type part of a city or region, such as Lagos or New_York.">
            <Input type="search" name="time-zone-search" value={search} onChange={(event) => setSearch(event.target.value)} />
          </Field>
          <Field label="Time zone" error={error}>
            <Select
              name="time-zone"
              value={matches.includes(zone) ? zone : ""}
              disabled={busy}
              onChange={(event) => event.target.value && void change(event.target.value, false)}
            >
              {!matches.includes(zone) && <option value="">{matches.length === 0 ? "No match" : "Pick a time zone"}</option>}
              {matches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <form className={styles.form} onSubmit={onTypedSubmit} noValidate>
          <Field label="Time zone" hint="This browser cannot list time zones. Enter the name, such as Africa/Lagos." error={error}>
            <Input name="time-zone" value={typed} onChange={(event) => setTyped(event.target.value)} autoCapitalize="none" spellCheck={false} />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={busy}>
              Save time zone
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
