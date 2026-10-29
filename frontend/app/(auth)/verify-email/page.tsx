"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type FormEvent } from "react";

import { Button, Field, Input, Notice } from "@/components/ui";
import { ApiError, resendCode, verifyEmail } from "@/lib/api";
import { authLink, CODE_LENGTH, safeNextPath } from "@/lib/auth-flow";
import { postVerifyDestination } from "@/lib/onboarding";
import { setSession } from "@/lib/session";

import styles from "../_components/auth.module.css";
import { CodeInput } from "../_components/CodeInput";
import { FormMessage, useFocusFirstProblem } from "../_components/FormMessage";
import { JunkFolderHint } from "../_components/JunkFolderHint";
import { ResendCodeButton, useResendCountdown } from "../_components/ResendCode";
import { useSignedInRedirect } from "../_components/useSignedInRedirect";

const RESENT_MESSAGE = "If that email needs verifying, a new code is on its way.";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}

function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const target = safeNextPath(params.get("next"));
  const justRegistered = params.get("sent") === "1";
  const emailParam = params.get("email") ?? "";

  useSignedInRedirect(target);

  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [message, setMessage] = useState("");
  const [resentNotice, setResentNotice] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const countdown = useResendCountdown(justRegistered);
  useFocusFirstProblem(formRef, attempt);

  const fail = (updates: { email?: string; code?: string; message?: string }) => {
    setEmailError(updates.email ?? "");
    setCodeError(updates.code ?? "");
    setMessage(updates.message ?? "");
    setAttempt((count) => count + 1);
  };

  const submit = async (digits: string) => {
    if (submitting) {
      return;
    }
    setMessage("");
    setEmailError("");
    setCodeError("");
    if (!email.trim()) {
      fail({ email: "Enter the email address you signed up with." });
      return;
    }
    if (digits.length !== CODE_LENGTH) {
      fail({ code: `Enter the ${CODE_LENGTH}-digit code from the email.` });
      return;
    }
    setSubmitting(true);
    try {
      const tokens = await verifyEmail(email.trim(), digits);
      setSession(tokens);
      // A freshly verified account starts onboarding unless it was heading somewhere specific.
      router.replace(postVerifyDestination(params.get("next")));
    } catch (error) {
      setCode("");
      // A wrong or expired code belongs on the code field; anything else (offline, throttled) is a notice.
      if (error instanceof ApiError && error.status === 400) {
        fail({ code: error.message });
      } else {
        fail({ message: (error as Error).message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(code);
  };

  const onResend = async () => {
    setMessage("");
    setEmailError("");
    setResentNotice(false);
    if (!email.trim()) {
      fail({ email: "Enter the email address you signed up with." });
      return;
    }
    setResending(true);
    try {
      await resendCode(email.trim());
      setResentNotice(true);
      countdown.start();
    } catch (error) {
      fail({ message: (error as Error).message });
    } finally {
      setResending(false);
    }
  };

  return (
    <>
      <h1 className={styles.title}>Check your email</h1>
      <p className={styles.lede}>Enter the 6-digit code to confirm your address. It expires in 15 minutes.</p>
      <JunkFolderHint />

      <form ref={formRef} className={styles.form} onSubmit={onSubmit}>
        {justRegistered && emailParam && (
          <Notice tone="success" title="Account created">
            We sent a 6-digit code to {emailParam}.
          </Notice>
        )}
        {message && <FormMessage tone="danger">{message}</FormMessage>}
        {resentNotice && <Notice tone="info">{RESENT_MESSAGE}</Notice>}

        <Field label="Email" error={emailError} required>
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
        <Field label="6-digit code" error={codeError} required>
          <CodeInput value={code} onChange={setCode} onComplete={(digits) => void submit(digits)} disabled={submitting} />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={submitting}>
            Verify email
          </Button>
        </div>

        <div className={styles.resendRow}>
          <ResendCodeButton secondsLeft={countdown.secondsLeft} loading={resending} onClick={() => void onResend()} />
        </div>
      </form>

      <p className={styles.alt}>
        Wrong address?{" "}
        <Link href={authLink("/sign-up", { next: params.get("next") })} className={styles.link}>
          Start again
        </Link>
      </p>
    </>
  );
}
