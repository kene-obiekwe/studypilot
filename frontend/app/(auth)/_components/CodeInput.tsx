"use client";

import { forwardRef, type ClipboardEvent, type ChangeEvent } from "react";

import { Input } from "@/components/ui";
import { CODE_LENGTH, sanitizeCode } from "@/lib/auth-flow";

import styles from "./auth.module.css";

type CodeInputProps = {
  value: string;
  onChange: (code: string) => void;
  /** Called once, when the sixth digit is typed or pasted. */
  onComplete?: (code: string) => void;
  disabled?: boolean;
};

/**
 * One input for the emailed 6-digit code. It keeps digits only, accepts a pasted "123 456" in full
 * (maxLength alone would cut the paste short), and offers the code from the email app on phones.
 * Render it inside a Field so it gets its label and error wiring.
 */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  { value, onChange, onComplete, disabled },
  ref,
) {
  const apply = (raw: string) => {
    const next = sanitizeCode(raw);
    onChange(next);
    if (next.length === CODE_LENGTH) {
      onComplete?.(next);
    }
  };

  return (
    <Input
      ref={ref}
      className={styles.code}
      value={value}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={CODE_LENGTH}
      placeholder="000000"
      spellCheck={false}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => apply(event.target.value)}
      onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
        event.preventDefault();
        apply(event.clipboardData.getData("text"));
      }}
    />
  );
});
