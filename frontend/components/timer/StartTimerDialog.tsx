"use client";

import { useId, useState, type FormEvent } from "react";
import { Play } from "lucide-react";

import { useShellData } from "@/components/app-shell/ShellData";
import { useTimeZone } from "@/components/app-shell/useTimeZone";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { clampPlanned, defaultPlannedMinutes, PLANNED_MAX, PLANNED_MIN, type TimerState } from "@/lib/timer";
import { startTimer } from "@/lib/timer-store";

export type StartCourse = { id: number; name: string; weeklyTargetHours?: number | null };

export function StartTimerDialog({ course, onClose }: { course: StartCourse; onClose: () => void }) {
  const { me, plans, sessions } = useShellData();
  const zone = useTimeZone();
  const formId = useId();
  const [suggested] = useState(() =>
    defaultPlannedMinutes({
      courseName: course.name,
      weeklyTargetHours: course.weeklyTargetHours,
      plans: plans ?? [],
      sessions: sessions ?? [],
      now: new Date(),
      zone,
    }),
  );
  const [planned, setPlanned] = useState(String(suggested));
  const value = Number(planned);
  const invalid = planned.trim() === "" || !Number.isFinite(value) || value < PLANNED_MIN || value > PLANNED_MAX;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    startTimer({ userId: me?.id ?? null, courseId: course.id, courseName: course.name, startedAt: Date.now(), plannedMinutes: clampPlanned(value) });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Start a timer for ${course.name}`}
      description="The timer keeps running if you refresh or switch tabs. Stop it when you finish to log the session."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} icon={<Play size={16} />} disabled={invalid}>
            Start timer
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit}>
        <Field
          label="Planned minutes"
          hint={`Suggested ${suggested} min: this week's session length for the course, shortened to what's left of its weekly hours.`}
          error={invalid ? `Enter a number from ${PLANNED_MIN} to ${PLANNED_MAX}.` : undefined}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={PLANNED_MIN}
            max={PLANNED_MAX}
            step={5}
            value={planned}
            onChange={(event) => setPlanned(event.target.value)}
            autoFocus
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** Only one timer at a time: starting another asks to stop the running one first. */
export function ConflictDialog({
  running,
  wanted,
  onStop,
  onClose,
}: {
  running: TimerState;
  wanted: StartCourse;
  onStop: () => void;
  onClose: () => void;
}) {
  const same = running.courseId === wanted.id;
  return (
    <Dialog
      open
      onClose={onClose}
      title={same ? `A timer is already running for ${running.courseName}` : `A timer is running for ${running.courseName}`}
      description={
        same
          ? "Stop it to log the session."
          : `Only one timer runs at a time. Stop and log ${running.courseName} first, then start ${wanted.name}.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it running
          </Button>
          <Button variant="primary" onClick={onStop}>
            Stop and log it
          </Button>
        </>
      }
    />
  );
}
