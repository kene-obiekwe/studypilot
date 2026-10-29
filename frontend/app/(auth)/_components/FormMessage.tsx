"use client";

import { useEffect, type ReactNode, type RefObject } from "react";

import { Notice, type NoticeTone } from "@/components/ui";

import styles from "./auth.module.css";

/**
 * Moves focus to the first invalid field in `formRef`, or to the message slot when no field is
 * invalid, each time `attempt` changes (start it at 0 and increase it after every failed submit).
 */
export function useFocusFirstProblem(formRef: RefObject<HTMLElement | null>, attempt: number): void {
  useEffect(() => {
    if (attempt === 0) {
      return;
    }
    const root = formRef.current;
    const invalid = root?.querySelector<HTMLElement>("[aria-invalid='true']");
    (invalid ?? root?.querySelector<HTMLElement>("[data-form-message]"))?.focus();
  }, [formRef, attempt]);
}

/** A Notice in a focusable slot, so a failed submit can move focus to it (see useFocusFirstProblem). */
export function FormMessage({ tone, title, children }: { tone: NoticeTone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div tabIndex={-1} data-form-message="" className={styles.messageSlot}>
      <Notice tone={tone} title={title}>
        {children}
      </Notice>
    </div>
  );
}
