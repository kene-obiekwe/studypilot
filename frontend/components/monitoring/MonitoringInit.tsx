"use client";

import { useEffect } from "react";

import { initMonitoring } from "@/lib/monitoring";

/** Starts error tracking after the page has rendered. Renders nothing. */
export function MonitoringInit() {
  useEffect(() => {
    initMonitoring();
  }, []);
  return null;
}
