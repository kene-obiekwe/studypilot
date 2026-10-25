"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type FormEvent } from "react";

import { Button, Field, Input } from "@/components/ui";
import { ApiError, startRegistration } from "@/lib/api";
import { authLink, safeNextPath } from "@/lib/auth-flow";

import styles from "../_components/auth.module.css";
import { FormMessage, useFocusFirstProblem } from "../_components/FormMessage";
import { useSignedInRedirect } from "../_components/useSignedInRedirect";

const PASSWORD_HINT =
  "At least 8 characters. Not a common password, not only numbers, and not similar to your username or email.";

type FieldName = "username" | "email" | "password";

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextRaw = params.get("next");
  const carriedNext = nextRaw && safeNextPath(nextRaw) === nextRaw ? nextRaw : null;

  useSignedInRedirect(safeNextPath(nextRaw));

  const formRef = useRef<HTMLFormElement>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useFocusFirstProblem(formRef, attempt);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setFieldErrors({});
    setMessage("");
    setSubmitting(true);
    try {
      const result = await startRegistration({ username: username.trim(), email: email.trim(), password });
      router.push(authLink("/verify-email", { email: result.email, sent: true, next: carriedNext }));
    } catch (error) {
      const errors: Partial<Record<FieldName, string>> = {};
      if (error instanceof ApiError) {
        for (const name of ["username", "email", "password"] as const) {
          const first = error.fieldErrors[name]?.[0];
          if (first) {
            errors[name] = first;
          }
        }
      }
      setFieldErrors(errors);
      // Without a field to attach it to, show the message as it came.
      setMessage(Object.keys(errors).length === 0 ? (error as Error).message : "");
      setAttempt((count) => count + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 className={styles.title}>Create your account</h1>
      <p className={styles.lede}>We will email you a 6-digit code to confirm your address.</p>

      <form ref={formRef} className={styles.form} onSubmit={onSubmit}>
        {message && <FormMessage tone="danger">{message}</FormMessage>}

        <Field label="Username" error={fieldErrors.username} required>
          <Input
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={150}
          />
        </Field>
        <Field label="Email" error={fieldErrors.email} required>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
          />
        </Field>
        <Field label="Password" hint={PASSWORD_HINT} error={fieldErrors.password} required>
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={submitting}>
            Create account
          </Button>
        </div>
      </form>

      <p className={styles.alt}>
        Already have an account?{" "}
        <Link href={authLink("/sign-in", { next: carriedNext })} className={styles.link}>
          Sign in
        </Link>
      </p>
    </>
  );
}
