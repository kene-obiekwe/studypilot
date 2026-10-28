"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type FormEvent } from "react";

import { Button, Field, Input, Notice, PasswordInput } from "@/components/ui";
import { isEmailNotVerified, loginUser } from "@/lib/api";
import { authLink, safeNextPath } from "@/lib/auth-flow";
import { setSession } from "@/lib/session";

import styles from "../_components/auth.module.css";
import { FormMessage, useFocusFirstProblem } from "../_components/FormMessage";
import { useSignedInRedirect } from "../_components/useSignedInRedirect";

type Problem = { kind: "error"; text: string } | { kind: "unverified" } | null;

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextRaw = params.get("next");
  const target = safeNextPath(nextRaw);
  // Carry `next` to the other auth screens only when it is a path we would follow.
  const carriedNext = nextRaw && safeNextPath(nextRaw) === nextRaw ? nextRaw : null;
  const expired = params.get("reason") === "expired";

  useSignedInRedirect(target);

  const formRef = useRef<HTMLFormElement>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [attempt, setAttempt] = useState(0);
  useFocusFirstProblem(formRef, attempt);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setProblem(null);
    setSubmitting(true);
    try {
      const tokens = await loginUser({ identifier: identifier.trim(), password });
      setSession(tokens);
      setShowPassword(false);
      router.replace(target);
    } catch (error) {
      setProblem(isEmailNotVerified(error) ? { kind: "unverified" } : { kind: "error", text: (error as Error).message });
      setAttempt((count) => count + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.lede}>Welcome back. Pick up where you left off.</p>

      <form ref={formRef} className={styles.form} onSubmit={onSubmit}>
        {expired && <Notice tone="info">Your session expired. Sign in again.</Notice>}

        {problem?.kind === "error" && <FormMessage tone="danger">{problem.text}</FormMessage>}
        {problem?.kind === "unverified" && (
          <FormMessage tone="warning" title="Verify your email first.">
            <div className={styles.stack}>
              <span>Enter the 6-digit code we emailed you when you signed up.</span>
              <Button size="sm" onClick={() => router.push(authLink("/verify-email", { next: carriedNext }))}>
                Enter your code
              </Button>
            </div>
          </FormMessage>
        )}

        <Field label="Username or email" required>
          <Input
            name="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <div>
          <Field label="Password" required>
            <PasswordInput
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              revealed={showPassword}
              onRevealedChange={setShowPassword}
              autoComplete="current-password"
            />
          </Field>
          <div className={styles.rowEnd}>
            <Link href={authLink("/forgot-password", { next: carriedNext })} className={styles.link}>
              Forgot password?
            </Link>
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={submitting}>
            Sign in
          </Button>
        </div>
      </form>

      <p className={styles.alt}>
        New to StudyPilot?{" "}
        <Link href={authLink("/sign-up", { next: carriedNext })} className={styles.link}>
          Create an account
        </Link>
      </p>
    </>
  );
}
