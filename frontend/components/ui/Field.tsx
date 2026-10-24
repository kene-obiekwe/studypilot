"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

type FieldContextValue = { id: string; describedBy?: string; invalid: boolean; required: boolean };

const FieldContext = createContext<FieldContextValue | null>(null);

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown below the control and announced with it; also marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label, hint and error wired to the Input / Select / Textarea inside it. */
export function Field({ label, hint, error, required = false, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cx(styles.field, className)}>
        <label htmlFor={id} className={styles.label}>
          {label}
          {required && (
            <span aria-hidden="true" style={{ color: "var(--sp-danger)" }}>
              {" "}
              *
            </span>
          )}
        </label>
        {children}
        {hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className={styles.error}>
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

function useFieldControl(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: unknown; required?: boolean }) {
  const field = useContext(FieldContext);
  if (!field) return {};
  return {
    id: props.id ?? field.id,
    "aria-describedby": [field.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined,
    "aria-invalid": field.invalid || undefined,
    required: props.required ?? (field.required || undefined),
  };
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  const control = useFieldControl(props);
  return <input {...props} {...control} ref={ref} className={cx(styles.control, styles.input, className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  const control = useFieldControl(props);
  return (
    <select
      {...props}
      {...control}
      ref={ref}
      className={cx(styles.control, styles.input, styles.select, className)}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  const control = useFieldControl(props);
  return (
    <textarea
      {...props}
      {...control}
      ref={ref}
      className={cx(styles.control, styles.input, styles.textarea, className)}
    />
  );
});
