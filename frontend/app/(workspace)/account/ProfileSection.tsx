"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button, Card, Field, Input, Notice, PasswordInput } from "@/components/ui";
import { ApiError, confirmEmailChange, requestEmailChange, updateUsername, type Me } from "@/lib/api";
import { CODE_LENGTH } from "@/lib/auth-flow";

import { CodeInput } from "../../(auth)/_components/CodeInput";
import { FormMessage, useFocusFirstProblem } from "../../(auth)/_components/FormMessage";
import { ResendCodeButton, useResendCountdown } from "../../(auth)/_components/ResendCode";
import styles from "./account.module.css";

export const USERNAME_HINT = "Up to 150 characters: letters, digits and @ . + - _ only.";

type Props = { me: Me; onChanged: () => void };

/** Username and email. `onChanged` refreshes the shell, so the account menu shows the new values. */
export function ProfileSection({ me, onChanged }: Props) {
  const titleId = useId();
  return (
    <Card as="section" className={styles.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Profile
      </h2>
      <UsernameForm me={me} onChanged={onChanged} />
      <hr className={styles.divider} />
      <EmailChange me={me} onChanged={onChanged} />
    </Card>
  );
}

function UsernameForm({ me, onChanged }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [username, setUsername] = useState(me.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const [attempt, setAttempt] = useState(0);
  useFocusFirstProblem(formRef, attempt);

  const fail = (field: string, text = "") => {
    setError(field);
    setMessage(text);
    setAttempt((count) => count + 1);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaved("");
    const name = username.trim();
    if (!name) {
      fail("Enter a username.");
      return;
    }
    if (name === me.username) {
      fail("That is already your username.");
      return;
    }
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const updated = await updateUsername(name);
      setUsername(updated.username);
      setSaved(`Your username is now ${updated.username}.`);
      onChanged();
    } catch (failure) {
      const problem = failure instanceof ApiError ? failure.fieldErrors.username?.[0] : undefined;
      if (problem) fail(problem);
      else fail("", (failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={(event) => void onSubmit(event)} noValidate>
      {message && <FormMessage tone="danger">{message}</FormMessage>}
      {saved && <Notice tone="success">{saved}</Notice>}
      <Field label="Username" hint={USERNAME_HINT} error={error} required>
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
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={saving}>
          Save username
        </Button>
      </div>
    </form>
  );
}

type Step = "idle" | "request" | "code";
type EmailErrors = { password?: string; newEmail?: string; code?: string };

/**
 * Changing the email takes two steps: the password and the new address, which emails a code to that
 * address; then the code. The account's address changes only after the code. Leaving the page
 * midway simply means starting again (the API doesn't expose a pending change).
 */
function EmailChange({ me, onChanged }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const newEmailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [errors, setErrors] = useState<EmailErrors>({});
  const [message, setMessage] = useState("");
  const [resent, setResent] = useState(false);
  const [done, setDone] = useState("");
  const [attempt, setAttempt] = useState(0);
  const countdown = useResendCountdown(false);
  useFocusFirstProblem(formRef, attempt);

  // Each step replaces the controls the user was on, so focus moves to the new step's first one.
  useEffect(() => {
    if (!moved.current) return;
    if (step === "request") newEmailRef.current?.focus();
    else if (step === "code") codeRef.current?.focus();
    else startRef.current?.focus();
  }, [step]);

  const go = (next: Step) => {
    moved.current = true;
    setErrors({});
    setMessage("");
    setResent(false);
    setStep(next);
  };

  const fail = (next: EmailErrors, text = "") => {
    setErrors(next);
    setMessage(text);
    setAttempt((count) => count + 1);
  };

  const reset = () => {
    setPassword("");
    setNewEmail("");
    setSentTo("");
    setCode("");
    setShowPassword(false);
  };

  const cancel = () => {
    reset();
    go("idle");
  };

  const sendCode = async (resend: boolean) => {
    setMessage("");
    setResent(false);
    const address = resend ? sentTo : newEmail.trim();
    if (!resend) {
      const missing: EmailErrors = {};
      if (!address) missing.newEmail = "Enter your new email address.";
      if (!password) missing.password = "Enter your password.";
      if (missing.newEmail || missing.password) {
        fail(missing);
        return;
      }
      setErrors({});
    }
    (resend ? setResending : setBusy)(true);
    try {
      const result = await requestEmailChange({ password, new_email: address });
      setSentTo(result.email);
      setCode("");
      countdown.start();
      if (resend) setResent(true);
      else {
        setShowPassword(false);
        go("code");
      }
    } catch (failure) {
      const fields = failure instanceof ApiError ? failure.fieldErrors : {};
      const found: EmailErrors = { password: fields.password?.[0], newEmail: fields.new_email?.[0] };
      if (!resend && (found.password || found.newEmail)) fail(found);
      else fail({}, (failure as Error).message);
    } finally {
      (resend ? setResending : setBusy)(false);
    }
  };

  const confirm = async (digits: string) => {
    if (busy) return;
    setMessage("");
    if (digits.length !== CODE_LENGTH) {
      fail({ code: `Enter the ${CODE_LENGTH}-digit code from the email.` });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const updated = await confirmEmailChange(digits);
      reset();
      setDone(`Your email is now ${updated.email}.`);
      go("idle");
      onChanged();
    } catch (failure) {
      setCode("");
      if (failure instanceof ApiError && failure.status === 400) fail({ code: failure.message });
      else fail({}, (failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === "idle") {
    return (
      <div className={styles.section}>
        {done && <Notice tone="success">{done}</Notice>}
        <div className={styles.emailRow}>
          <div>
            <p className={styles.emailLabel}>Email</p>
            <p className={styles.emailValue}>{me.email || "No email address"}</p>
          </div>
          <Button
            ref={startRef}
            onClick={() => {
              setDone("");
              go("request");
            }}
          >
            Change email
          </Button>
        </div>
      </div>
    );
  }

  if (step === "request") {
    return (
      <form
        ref={formRef}
        className={styles.form}
        aria-label="Change email"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void sendCode(false);
        }}
      >
        <p className={styles.sectionLede}>
          Your email is {me.email}. We will send a 6-digit code to the new address to confirm it.
        </p>
        {message && <FormMessage tone="danger">{message}</FormMessage>}
        <Field label="New email" error={errors.newEmail} required>
          <Input
            ref={newEmailRef}
            name="new-email"
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
          />
        </Field>
        <Field label="Password" hint="Your current password, to confirm it's you." error={errors.password} required>
          <PasswordInput
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            revealed={showPassword}
            onRevealedChange={setShowPassword}
            autoComplete="current-password"
          />
        </Field>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={busy}>
            Send code
          </Button>
          <Button onClick={cancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      ref={formRef}
      className={styles.form}
      aria-label="Confirm new email"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void confirm(code);
      }}
    >
      <Notice tone="info" title="Check your email">
        We sent a code to {sentTo}. Check your spam or junk folder.
      </Notice>
      {message && <FormMessage tone="danger">{message}</FormMessage>}
      {resent && <Notice tone="info">A new code is on its way to {sentTo}.</Notice>}
      <Field label="6-digit code" hint="It expires in 15 minutes." error={errors.code} required>
        <CodeInput ref={codeRef} value={code} onChange={setCode} onComplete={(digits) => void confirm(digits)} disabled={busy} />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy}>
          Confirm email
        </Button>
        <Button onClick={() => go("request")} disabled={busy}>
          Use a different email
        </Button>
        <Button variant="ghost" onClick={cancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      <div className={styles.resendRow}>
        <ResendCodeButton secondsLeft={countdown.secondsLeft} loading={resending} onClick={() => void sendCode(true)} />
      </div>
    </form>
  );
}
