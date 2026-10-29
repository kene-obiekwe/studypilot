"use client";

import { useId, useState, type FormEvent } from "react";

import { Button, Dialog, Field, Input, Notice } from "@/components/ui";
import {
  describeElapsed,
  elapsedMs,
  formatElapsed,
  MAX_ACTUAL_MINUTES,
  parseTimer,
  prefillActualMinutes,
  type TimerState,
} from "@/lib/timer";
import { logStudySession } from "@/lib/timer-refresh";
import { clearTimer, getTimerSnapshot, useNow } from "@/lib/timer-store";

import { CompletionScale, DEFAULT_COMPLETION, DEFAULT_FOCUS, FocusScale } from "./SessionScales";
import styles from "./timer.module.css";

/** Clears the timer only if it is still this one (another tab may have replaced it). */
function clearIfCurrent(timer: TimerState) {
  if (parseTimer(getTimerSnapshot())?.startedAt === timer.startedAt) clearTimer();
}

/** "How did it go?": logs the timer's session, or discards it. Cancel keeps it running. */
export function StopTimerDialog({
  timer,
  onClose,
  onSaved,
}: {
  timer: TimerState;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const formId = useId();
  const now = useNow();
  // Pre-filled once, when the dialog opens; the clock keeps running behind it.
  const [prefill] = useState(() => prefillActualMinutes(elapsedMs(timer, Date.now())));
  const [actual, setActual] = useState(String(prefill.minutes));
  const [focus, setFocus] = useState(DEFAULT_FOCUS);
  const [completion, setCompletion] = useState(DEFAULT_COMPLETION);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState("");

  const minutes = Number(actual);
  const invalid = actual.trim() === "" || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ACTUAL_MINUTES;
  const elapsed = elapsedMs(timer, now);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || saving) return;
    setSaving(true);
    setError("");
    try {
      await logStudySession({
        course_name: timer.courseName,
        planned_minutes: timer.plannedMinutes,
        actual_minutes: minutes,
        focus_score: Number(focus),
        completion_rate: Number(completion),
      });
      clearIfCurrent(timer);
      onSaved(`Logged ${minutes} min of ${timer.courseName}.`);
    } catch (failure) {
      setError((failure as Error).message);
      setSaving(false);
    }
  };

  const discard = () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    clearIfCurrent(timer);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={saving ? () => undefined : onClose}
      closeOnBackdrop={false}
      title="How did it go?"
      description={
        <>
          {timer.courseName}: <span aria-hidden="true">{formatElapsed(elapsed)}</span>
          <span className={styles.srOnly}>{describeElapsed(elapsed)}</span> so far, {timer.plannedMinutes} min planned.
        </>
      }
      footer={
        <>
          <Button variant="ghost" className={styles.discard} onClick={discard} disabled={saving}>
            {confirmDiscard ? "Yes, discard it" : "Discard"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Keep running
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={saving} disabled={invalid}>
            Save session
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={onSubmit}>
        {error && (
          <Notice tone="danger" title="Couldn't log the session">
            {error} The timer is still running; you can try again or discard it.
          </Notice>
        )}
        {confirmDiscard && (
          <Notice tone="warning">Discarding ends the timer without logging anything. Select &ldquo;Yes, discard it&rdquo; to confirm.</Notice>
        )}
        <Field
          label="Actual minutes"
          hint={
            prefill.capped
              ? "This timer ran for over 12 hours, so we filled in 12 hours. Check the number."
              : "Filled in from the timer. Change it if you took breaks."
          }
          error={invalid ? `Enter a whole number from 1 to ${MAX_ACTUAL_MINUTES}.` : undefined}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ACTUAL_MINUTES}
            value={actual}
            onChange={(event) => setActual(event.target.value)}
          />
        </Field>
        <FocusScale value={focus} onChange={setFocus} />
        <CompletionScale value={completion} onChange={setCompletion} />
      </form>
    </Dialog>
  );
}
