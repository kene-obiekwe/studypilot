"use client";

import { useEffect } from "react";

import { wakeBackend } from "@/lib/api";

/** Starts waking the sleeping backend as soon as a visitor lands. Renders nothing. */
export function WakeBackend() {
  useEffect(() => {
    wakeBackend();
  }, []);
  return null;
}
