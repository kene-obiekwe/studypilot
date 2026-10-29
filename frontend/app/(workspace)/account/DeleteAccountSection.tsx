"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { Button, Card, Dialog, Field, Input, Notice, PasswordInput } from "@/components/ui";
import { ApiError, DELETE_ACCOUNT_CONFIRMATION, deleteAccount, listCourses, type Me } from "@/lib/api";
import { clearSession } from "@/lib/session";

import styles from "./account.module.css";
import { clearLocalUserData } from "./local-data";

/** Where a deleted account lands: the landing page, which shows a short notice for this flag. */
export const ACCOUNT_DELETED_PATH = "/?account=deleted";

export function DeleteAccountSection({ me }: { me: Me }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  return (
    <Card as="section" className={styles.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Delete account
      </h2>
      <p className={styles.sectionLede}>Permanently delete your account and everything in it. This can&apos;t be undone.</p>
      <div className={styles.actions}>
        <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>
      {open && <DeleteAccountDialog me={me} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function DeleteAccountDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const router = useRouter();
  const formId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [message, setMessage] = useState("");
  const confirmed = confirm === DELETE_ACCOUNT_CONFIRMATION;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setMessage("");
    setConfirmError(confirmed ? "" : `Type ${DELETE_ACCOUNT_CONFIRMATION} to confirm.`);
    setPasswordError(password ? "" : "Enter your password.");
    if (!password) {
      passwordRef.current?.focus();
      return;
    }
    if (!confirmed) return;
    setBusy(true);
    try {
      // Read before the account goes: these ids are this user's collapse choices on /strategies.
      const courseIds = await listCourses().then(
        (courses) => courses.map((course) => course.id),
        () => [],
      );
      await deleteAccount({ password, confirm });
      clearLocalUserData(me.id, courseIds);
      clearSession();
      router.replace(ACCOUNT_DELETED_PATH);
    } catch (failure) {
      const fields = failure instanceof ApiError ? failure.fieldErrors : {};
      if (fields.password?.[0]) {
        setPasswordError(fields.password[0]);
        passwordRef.current?.focus();
      } else if (fields.confirm?.[0]) {
        setConfirmError(fields.confirm[0]);
      } else {
        setMessage((failure as Error).message);
      }
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={false}
      title="Delete your account?"
      description="This permanently deletes your account. It can't be undone."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" disabled={!confirmed} loading={busy}>
            Delete account
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void onSubmit(event)} noValidate>
        {message && <Notice tone="danger">{message}</Notice>}
        <div>
          <p className={styles.emailLabel}>What is removed</p>
          <ul className={styles.removedList}>
            <li>Your courses</li>
            <li>Your weekly plans and their history</li>
            <li>Your logged study sessions</li>
            <li>Your strategy history and feedback</li>
          </ul>
        </div>
        <Field label="Password" error={passwordError} required>
          <PasswordInput
            ref={passwordRef}
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            revealed={showPassword}
            onRevealedChange={setShowPassword}
            autoComplete="current-password"
          />
        </Field>
        <Field label={`Type ${DELETE_ACCOUNT_CONFIRMATION} to confirm`} error={confirmError} required>
          <Input
            name="confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </Field>
      </form>
    </Dialog>
  );
}
