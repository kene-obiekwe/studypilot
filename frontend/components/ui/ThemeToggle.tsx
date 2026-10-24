"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { getServerPreference, readPreference, setPreference, subscribe, type ThemePreference } from "../../lib/theme";

import { SegmentedControl } from "./SegmentedControl";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  { value: "system", label: "System", icon: <Monitor size={14} /> },
];

/** Light / dark / system. Reads the stored preference through useSyncExternalStore (no effects). */
export function ThemeToggle({ className }: { className?: string }) {
  const preference = useSyncExternalStore(subscribe, readPreference, getServerPreference);
  return <SegmentedControl label="Theme" options={OPTIONS} value={preference} onChange={setPreference} className={className} />;
}
