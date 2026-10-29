"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { resendReadyAt, resendSecondsLeft } from "@/lib/auth-flow";

/**
 * Tracks the resend cooldown. `start()` begins a new 60-second wait; `secondsLeft` ticks down once
 * a second while it runs. Pass `startNow` when a code has just been sent.
 */
export function useResendCountdown(startNow: boolean): { secondsLeft: number; start: () => void } {
  const [readyAt, setReadyAt] = useState(() => (startNow ? resendReadyAt(Date.now()) : 0));
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = resendSecondsLeft(readyAt, now);

  const running = secondsLeft > 0;
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return {
    secondsLeft,
    start: () => {
      const current = Date.now();
      setNow(current);
      setReadyAt(resendReadyAt(current));
    },
  };
}

type ResendCodeButtonProps = {
  secondsLeft: number;
  loading?: boolean;
  onClick: () => void;
};

export function ResendCodeButton({ secondsLeft, loading = false, onClick }: ResendCodeButtonProps) {
  const waiting = secondsLeft > 0;
  return (
    <Button variant="ghost" size="sm" loading={loading} disabled={waiting} onClick={onClick}>
      {waiting ? `Send a new code in ${secondsLeft} s` : "Send a new code"}
    </Button>
  );
}
