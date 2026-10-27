"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button, Notice, Skeleton } from "@/components/ui";
import {
  getMe,
  getPlanHistory,
  getSessionHistory,
  listCourses,
  type Course,
  type Me,
  type PlanHistoryItem,
  type SessionHistoryItem,
} from "@/lib/api";
import { markOnboardingDone, resolveStep, type OnboardingStep } from "@/lib/onboarding";
import { useCourseColors } from "@/lib/use-course-colors";
import { hasPlanThisWeek } from "@/lib/week";

import styles from "../onboarding.module.css";
import { CoursesStep } from "./CoursesStep";
import { PlanStep } from "./PlanStep";
import { SessionStep } from "./SessionStep";
import { StepIndicator } from "./StepIndicator";

type Loaded = { me: Me | null; courses: Course[]; plans: PlanHistoryItem[]; sessions: SessionHistoryItem[] };

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Loaded };

const COPY: Record<OnboardingStep, { title: string; lede: string }> = {
  1: {
    title: "Add your courses",
    lede: "Add each course you are taking. StudyPilot suggests how demanding it is from the name, and you check it.",
  },
  2: {
    title: "Plan your week",
    lede: "Say how many hours you can study. StudyPilot splits them across your courses, giving harder ones more.",
  },
  3: {
    title: "Start your first session",
    lede: "Time a session now, or log one you already did. Either gives StudyPilot something to learn from.",
  },
};

/** Courses are required; the rest degrade on their own (no plan history just means starting at the plan step). */
async function loadOnboarding(): Promise<Loaded> {
  const [me, courses, plans, sessions] = await Promise.allSettled([getMe(), listCourses(), getPlanHistory(), getSessionHistory()]);
  if (courses.status === "rejected") throw courses.reason;
  return {
    me: me.status === "fulfilled" ? me.value : null,
    courses: courses.value,
    plans: plans.status === "fulfilled" ? plans.value.items : [],
    sessions: sessions.status === "fulfilled" ? sessions.value.items : [],
  };
}

export default function OnboardingPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", data: await loadOnboarding() });
    } catch (failure) {
      setState({ status: "error", message: (failure as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "ready") {
    return <Flow data={state.data} />;
  }
  if (state.status === "error") {
    return (
      <Notice tone="danger" title="Could not load your setup">
        <p>{state.message}</p>
        <Button
          size="sm"
          onClick={() => {
            setState({ status: "loading" });
            void load();
          }}
        >
          Try again
        </Button>
      </Notice>
    );
  }
  return (
    <div className={styles.loading} aria-busy="true" aria-label="Loading your setup">
      <Skeleton width={220} height={24} />
      <Skeleton height={160} radius="lg" />
    </div>
  );
}

function Flow({ data }: { data: Loaded }) {
  const [courses, setCourses] = useState(data.courses);
  const [plans, setPlans] = useState(data.plans);
  const [step, setStep] = useState<OnboardingStep>(() =>
    resolveStep({ courseCount: data.courses.length, hasPlanThisWeek: hasPlanThisWeek(data.plans, new Date()) }),
  );
  const { colorFor } = useCourseColors(courses);
  const heading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);

  // Moving on is announced by moving focus to the new step's heading (not on first load).
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    heading.current?.focus();
  }, [step]);

  const refreshPlans = () => {
    // Step 3 reads this week's plan to suggest a session length; a failure just keeps the old list.
    getPlanHistory().then(
      (history) => setPlans(history.items),
      () => undefined,
    );
  };

  const { title, lede } = COPY[step];

  return (
    <>
      <div className={styles.topRow}>
        <StepIndicator step={step} />
        <Link href="/home" className={styles.skip} onClick={() => markOnboardingDone(data.me?.id ?? null)}>
          Skip for now
        </Link>
      </div>

      <div>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        <p className={styles.lede}>{lede}</p>
      </div>

      {step === 1 && (
        <CoursesStep
          courses={courses}
          colorFor={colorFor}
          onAdded={(course) => setCourses((current) => [...current, course])}
          onRemoved={(id) => setCourses((current) => current.filter((course) => course.id !== id))}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && <PlanStep courses={courses} colorFor={colorFor} onGenerated={refreshPlans} onContinue={() => setStep(3)} />}
      {step === 3 && courses.length > 0 && (
        <SessionStep me={data.me} courses={courses} plans={plans} sessions={data.sessions} />
      )}
    </>
  );
}
