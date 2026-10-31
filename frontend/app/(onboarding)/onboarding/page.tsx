"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button, Notice, Skeleton } from "@/components/ui";
import {
  getMe,
  getSessionHistory,
  listCourses,
  listPlans,
  type Course,
  type Me,
  type SessionHistoryItem,
  type WeeklyPlan,
} from "@/lib/api";
import { markOnboardingDone, resolveStep, type OnboardingStep } from "@/lib/onboarding";
import { useCourseColors } from "@/lib/use-course-colors";
import { hasPlanNextWeek, hasPlanThisWeek } from "@/lib/week";
import { effectiveZone } from "@/lib/zone";

import styles from "../onboarding.module.css";
import { CoursesStep } from "./CoursesStep";
import { PlanStep } from "./PlanStep";
import { SessionStep } from "./SessionStep";
import { StepIndicator } from "./StepIndicator";

type Loaded = { me: Me | null; courses: Course[]; plans: WeeklyPlan[]; sessions: SessionHistoryItem[] };

type LoadResult = { data: Loaded } | { error: string };

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

/**
 * Never rejects. Courses are required; the rest degrade on their own (no plan history just means
 * starting at the plan step).
 */
function loadOnboarding(): Promise<LoadResult> {
  return Promise.allSettled([getMe(), listCourses(), listPlans(), getSessionHistory()]).then(
    ([me, courses, plans, sessions]) => {
      if (courses.status === "rejected") return { error: (courses.reason as Error).message };
      return {
        data: {
          me: me.status === "fulfilled" ? me.value : null,
          courses: courses.value,
          plans: plans.status === "fulfilled" ? plans.value : [],
          sessions: sessions.status === "fulfilled" ? sessions.value.items : [],
        },
      };
    },
  );
}

export default function OnboardingPage() {
  // Fetched once per page view (a lazy initialiser read with use(), not an effect).
  const [promise, setPromise] = useState(loadOnboarding);
  return (
    <Suspense
      fallback={
        <div className={styles.loading} aria-busy="true" aria-label="Loading your setup">
          <Skeleton width={220} height={24} />
          <Skeleton height={160} radius="lg" />
        </div>
      }
    >
      <Onboarding promise={promise} onRetry={() => setPromise(loadOnboarding())} />
    </Suspense>
  );
}

function Onboarding({ promise, onRetry }: { promise: Promise<LoadResult>; onRetry: () => void }) {
  const result = use(promise);
  if ("error" in result) {
    return (
      <Notice tone="danger" title="Could not load your setup">
        <p>{result.error}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  }
  return <Flow data={result.data} />;
}

function Flow({ data }: { data: Loaded }) {
  const [courses, setCourses] = useState(data.courses);
  const [plans, setPlans] = useState(data.plans);
  // Onboarding sits outside the workspace shell, so it reads the zone from the account it just loaded.
  const [zone] = useState(() => effectiveZone(data.me));
  const [step, setStep] = useState<OnboardingStep>(() =>
    resolveStep({
      courseCount: data.courses.length,
      hasPlanThisWeek: hasPlanThisWeek(data.plans, new Date(), zone),
      hasPlanNextWeek: hasPlanNextWeek(data.plans, new Date(), zone),
    }),
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
    listPlans().then(setPlans, () => undefined);
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
      {step === 2 && <PlanStep courses={courses} colorFor={colorFor} zone={zone} onSaved={refreshPlans} onContinue={() => setStep(3)} />}
      {step === 3 && courses.length > 0 && (
        <SessionStep me={data.me} courses={courses} plans={plans} sessions={data.sessions} zone={zone} />
      )}
    </>
  );
}
