"use client";

import { createContext, Suspense, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { useShellData } from "@/components/app-shell/ShellData";
import { IconButton, Notice } from "@/components/ui";
import { timerForUser, type TimerState } from "@/lib/timer";
import { useStoredTimer } from "@/lib/timer-store";

import { ConflictDialog, StartTimerDialog, type StartCourse } from "./StartTimerDialog";
import { StopTimerDialog } from "./StopTimerDialog";
import styles from "./timer.module.css";

type Pending = { kind: "start"; course: StartCourse } | { kind: "stop" } | null;

type TimerActions = {
  /** Opens the start dialog, or, while another timer runs, asks to stop that one first. */
  openStart: (course: StartCourse) => void;
  /** Opens "How did it go?" for the running timer. */
  openStop: () => void;
};

const TimerContext = createContext<TimerActions | null>(null);

export function useTimerActions(): TimerActions {
  const actions = use(TimerContext);
  if (!actions) throw new Error("useTimerActions must be used inside TimerProvider");
  return actions;
}

/**
 * The signed-in user's running timer, or null. Reads shell data (for the user id), so call it
 * inside a Suspense boundary.
 */
export function useActiveTimer(): TimerState | null {
  const { me } = useShellData();
  return timerForUser(useStoredTimer(), me?.id ?? null);
}

/** Holds the timer dialogs and the "Session logged" notice for the whole workspace. */
export function TimerProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>(null);
  const [saved, setSaved] = useState("");
  const hideNotice = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openStart = useCallback((course: StartCourse) => setPending({ kind: "start", course }), []);
  const openStop = useCallback(() => setPending({ kind: "stop" }), []);
  const actions = useMemo(() => ({ openStart, openStop }), [openStart, openStop]);

  const close = () => setPending(null);
  const onSaved = (message: string) => {
    setPending(null);
    setSaved(message);
    if (hideNotice.current) clearTimeout(hideNotice.current);
    hideNotice.current = setTimeout(() => setSaved(""), 8000);
  };

  return (
    <TimerContext.Provider value={actions}>
      {children}
      {pending && (
        <Suspense fallback={null}>
          <TimerDialogs pending={pending} onClose={close} onStop={openStop} onSaved={onSaved} />
        </Suspense>
      )}
      <div className={styles.toast}>
        {saved && (
          <Notice tone="success">
            <span className={styles.toastBody}>
              {saved}
              <IconButton aria-label="Dismiss" icon={<X size={16} />} size="sm" onClick={() => setSaved("")} />
            </span>
          </Notice>
        )}
      </div>
    </TimerContext.Provider>
  );
}

function TimerDialogs({
  pending,
  onClose,
  onStop,
  onSaved,
}: {
  pending: NonNullable<Pending>;
  onClose: () => void;
  onStop: () => void;
  onSaved: (message: string) => void;
}) {
  const timer = useActiveTimer();
  if (pending.kind === "start") {
    return timer ? (
      <ConflictDialog running={timer} wanted={pending.course} onStop={onStop} onClose={onClose} />
    ) : (
      <StartTimerDialog course={pending.course} onClose={onClose} />
    );
  }
  // The timer may have been stopped in another tab meanwhile.
  return timer ? <StopTimerDialog key={timer.startedAt} timer={timer} onClose={onClose} onSaved={onSaved} /> : null;
}
