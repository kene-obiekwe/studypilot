"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type InputHTMLAttributes, type MouseEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

import { IconButton } from "./Button";
import { cx } from "./cx";
import { Input } from "./Field";
import styles from "./ui.module.css";

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Controlled visibility, so a page can hide the password again (after a successful submit). */
  revealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
  /** What the button names: "Show <label>" / "Hide <label>". Give each field of a pair its own. */
  label?: string;
};

/**
 * A password field with a button inside it that shows or hides what was typed. Use it inside a Field
 * like Input. Pass `autoComplete` ("current-password" or "new-password") as usual: it is kept.
 * The label switches between "Show password" and "Hide password", which carries the state, so there is
 * no aria-pressed. A mouse or touch press on the button keeps the caret in the field; pressing it from the keyboard
 * leaves focus on the button.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { revealed, onRevealedChange, label = "password", className, ...props },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  const [internal, setInternal] = useState(false);
  const shown = revealed ?? internal;

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const next = !shown;
    if (revealed === undefined) setInternal(next);
    onRevealedChange?.(next);
    // detail is 0 for a keyboard-activated click: leave focus on the button for those.
    if (event.detail > 0) inputRef.current?.focus();
  };

  return (
    <div className={styles.passwordField}>
      <Input {...props} ref={inputRef} type={shown ? "text" : "password"} className={cx(styles.passwordInput, className)} />
      <IconButton
        aria-label={`${shown ? "Hide" : "Show"} ${label}`}
        icon={shown ? <EyeOff size={18} /> : <Eye size={18} />}
        size="sm"
        className={styles.passwordToggle}
        // Pressing the button must not take focus from the field (and move the caret).
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      />
    </div>
  );
});
