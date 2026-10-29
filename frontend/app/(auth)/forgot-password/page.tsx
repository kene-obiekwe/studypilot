"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type FormEvent } from "react";

import { Button, Field, Input, Notice, PasswordInput } from "@/components/ui";
import { ApiError, confirmPasswordReset, requestPasswordReset } from "@/lib/api";
import { authLink, CODE_LENGTH, safeNextPath } from "@/lib/auth-flow";

import styles from "../_components/auth.module.css";
import { CodeInput } from "../_components/CodeInput";
import { FormMessage, useFocusFirstProblem } from "../_components/FormMessage";
import { JunkFolderHint } from "../_components/JunkFolderHint";
import { ResendCodeButton, useResendCountdown } from "../_components/ResendCode";
import { useSignedInRedirect } from "../_components/useSignedInRedirect";

const SENT_MESSAGE = "If that email has an account, we sent a 6-digit code. It expires in 15 minutes.";
const PASSWORD_HINT =
  "At least 8 characters. Not a common password, not only numbers, and not similar to your username or email.";

type Step = "email" | "reset" | "done";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordFlow />
    </Suspense>
  );
}

function ForgotPasswordFlow() {
  const params = useSearchParams();
  const nextRaw = params.get("next");
  const carriedNext = nextRaw && safeNextPath(nextRaw) === nextRaw ? nextRaw : null;
  useSignedInRedirect(safeNextPath(nextRaw));

  const formRef = useRef<HTMLFormElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; code?: string; newPassword?: string; confirm?: string }>({});
  const [message, setMessage] = useState("");
  const [sentNotice, setSentNotice] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const countdown = useResendCountdown(false);
  useFocusFirstProblem(formRef, attempt);

  const fail = (next: typeof errors, text = "") => {
    setErrors(next);
    setMessage(text);
    setAttempt((count) => count + 1);
  };

  const sendCode = async (resend: boolean) => {
    setMessage("");
    setErrors({});
    if (!email.trim()) {
      fail({ email: "Enter the email address for your account." });
      return;
    }
    (resend ? setResending : setBusy)(true);
    try {
      await requestPasswordReset(email.trim());
      setSentNotice(true);
      countdown.start();
      setStep("reset");
    } catch (error) {
      fail({}, (error as Error).message);
    } finally {
      (resend ? setResending : setBusy)(false);
    }
  };

  const onSubmitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) {
      void sendCode(false);
    }
  };

  const onSubmitReset = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setMessage("");
    if (code.length !== CODE_LENGTH) {
      fail({ code: `Enter the ${CODE_LENGTH}-digit code from the email.` });
      return;
    }
    if (newPassword !== confirm) {
      fail({ confirm: "The passwords don't match. Type the same password twice." });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await confirmPasswordReset({ email: email.trim(), code, new_password: newPassword });
      setShowNewPassword(false);
      setShowConfirm(false);
      setStep("done");
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const passwordProblem = error.fieldErrors.new_password?.[0];
        if (passwordProblem) {
          fail({ newPassword: passwordProblem });
        } else {
          setCode("");
          fail({ code: error.message });
        }
      } else {
        fail({}, (error as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <>
        <h1 className={styles.title}>Reset your password</h1>
        <Notice tone="success" title="Password updated">
          You can sign in with your new password.
        </Notice>
        <div className={styles.actions} style={{ marginTop: "var(--sp-space-5)" }}>
          <Link href={authLink("/sign-in", { next: carriedNext })} className={styles.link}>
            Go to sign in
          </Link>
        </div>
      </>
    );
  }

  if (step === "email") {
    return (
      <>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.lede}>Enter your email and we will send you a 6-digit code.</p>

        <form ref={formRef} className={styles.form} onSubmit={onSubmitEmail}>
          {message && <FormMessage tone="danger">{message}</FormMessage>}
          <Field label="Email" error={errors.email} required>
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
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={busy}>
              Send code
            </Button>
          </div>
        </form>

        <p className={styles.alt}>
          Remembered it?{" "}
          <Link href={authLink("/sign-in", { next: carriedNext })} className={styles.link}>
            Sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.title}>Enter your code</h1>
      <p className={styles.lede}>Choose a new password for {email.trim()}.</p>
      <JunkFolderHint />

      <form ref={formRef} className={styles.form} onSubmit={(event) => void onSubmitReset(event)}>
        {message && <FormMessage tone="danger">{message}</FormMessage>}
        {sentNotice && <Notice tone="info">{SENT_MESSAGE}</Notice>}

        <Field label="6-digit code" error={errors.code} required>
          <CodeInput value={code} onChange={setCode} onComplete={() => passwordRef.current?.focus()} disabled={busy} />
        </Field>
        <Field label="New password" hint={PASSWORD_HINT} error={errors.newPassword} required>
          <PasswordInput
            ref={passwordRef}
            name="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            label="new password"
            revealed={showNewPassword}
            onRevealedChange={setShowNewPassword}
            autoComplete="new-password"
            minLength={8}
          />
        </Field>
        <Field label="Confirm new password" error={errors.confirm} required>
          <PasswordInput
            name="confirm-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            label="confirmation"
            revealed={showConfirm}
            onRevealedChange={setShowConfirm}
            autoComplete="new-password"
          />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={busy}>
            Update password
          </Button>
        </div>

        <div className={styles.resendRow}>
          <ResendCodeButton secondsLeft={countdown.secondsLeft} loading={resending} onClick={() => void sendCode(true)} />
          <Button variant="ghost" size="sm" onClick={() => setStep("email")}>
            Use a different email
          </Button>
        </div>
      </form>
    </>
  );
}
