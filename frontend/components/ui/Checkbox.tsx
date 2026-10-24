"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Check } from "lucide-react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  hint?: ReactNode;
};

/** A native checkbox (keyboard and form behaviour for free) with a custom look. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className, id, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <label htmlFor={inputId} className={cx(styles.checkbox, className)}>
      <span className={styles.checkboxBox}>
        <input
          {...props}
          ref={ref}
          id={inputId}
          type="checkbox"
          aria-describedby={hintId}
          className={cx(styles.control, styles.checkboxInput)}
        />
        <span className={styles.checkboxMark} aria-hidden="true">
          <Check size={14} strokeWidth={3} />
        </span>
      </span>
      <span>{label}</span>
      {hint && (
        <span id={hintId} className={styles.checkboxHint}>
          {hint}
        </span>
      )}
    </label>
  );
});
