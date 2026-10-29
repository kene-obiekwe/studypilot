"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { Button, Card, Field, Notice, PasswordInput } from "@/components/ui";
import { ApiError, changePassword } from "@/lib/api";

import { FormMessage, useFocusFirstProblem } from "../../(auth)/_components/FormMessage";
import styles from "./account.module.css";

// The same rules as sign-up and password reset.
export const PASSWORD_HINT =
  "At least 8 characters. Not a common password, not only numbers, and not similar to your username or email.";
export const MISMATCH_MESSAGE = "The passwords don't match. Type the same password twice.";

type Errors = { current?: string; next?: string; confirm?: string };

export function PasswordSection() {
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState({ current: false, next: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useFocusFirstProblem(formRef, attempt);

  const fail = (found: Errors, text = "") => {
    setErrors(found);
    setMessage(text);
    setAttempt((count) => count + 1);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSaved(false);
    setMessage("");
    const missing: Errors = {};
    if (!current) missing.current = "Enter your current password.";
    if (!next) missing.next = "Enter a new password.";
    else if (next !== confirm) missing.confirm = MISMATCH_MESSAGE;
    if (Object.keys(missing).length > 0) {
      fail(missing);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await changePassword({ current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setShown({ current: false, next: false, confirm: false });
      setSaved(true);
    } catch (failure) {
      const fields = failure instanceof ApiError ? failure.fieldErrors : {};
      const found: Errors = { current: fields.current_password?.[0], next: fields.new_password?.[0] };
      if (found.current || found.next) fail(found);
      else fail({}, (failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reveal = (field: keyof typeof shown) => (value: boolean) => setShown((state) => ({ ...state, [field]: value }));

  return (
    <Card as="section" className={styles.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Password
      </h2>
      <form ref={formRef} className={styles.form} onSubmit={(event) => void onSubmit(event)} noValidate>
        {message && <FormMessage tone="danger">{message}</FormMessage>}
        {saved && <Notice tone="success">Your password has been changed.</Notice>}
        <Field label="Current password" error={errors.current} required>
          <PasswordInput
            name="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            label="current password"
            revealed={shown.current}
            onRevealedChange={reveal("current")}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password" hint={PASSWORD_HINT} error={errors.next} required>
          <PasswordInput
            name="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            label="new password"
            revealed={shown.next}
            onRevealedChange={reveal("next")}
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
            revealed={shown.confirm}
            onRevealedChange={reveal("confirm")}
            autoComplete="new-password"
          />
        </Field>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={busy}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
