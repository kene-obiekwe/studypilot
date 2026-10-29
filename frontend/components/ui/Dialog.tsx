"use client";

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";

import { IconButton } from "./Button";
import { cx } from "./cx";
import styles from "./ui.module.css";

export type DialogProps = {
  open: boolean;
  /** Called on Esc, the close button, a backdrop click (unless disabled) or form method="dialog". */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions, right-aligned. Put the primary action last. */
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
  className?: string;
};

/**
 * A modal on the native <dialog>: showModal() makes the rest of the page inert (focus stays
 * inside) and Esc closes it. Focus returns to whatever was focused when it opened.
 */
export function Dialog({ open, onClose, title, description, children, footer, closeOnBackdrop = true, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Sync the DOM dialog with the `open` prop (no React state is set here).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Return focus when the dialog closes for any reason, including unmounting while open. If what
  // opened it is gone (a Start button that became Stop), the page's main area gets the focus.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const restoreFocus = () => {
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target?.isConnected) target.focus();
      else document.getElementById("main-content")?.focus({ preventScroll: true });
    };
    dialog.addEventListener("close", restoreFocus);
    return () => {
      dialog.removeEventListener("close", restoreFocus);
      if (dialog.open) restoreFocus();
    };
  }, []);

  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    // A click on the <dialog> itself (not its content) is a click on the backdrop.
    if (closeOnBackdrop && event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cx(styles.dialog, className)}
      onCancel={(event) => {
        event.preventDefault(); // let the parent decide via `open`
        onClose();
      }}
      onClick={onBackdropClick}
    >
      <div className={styles.dialogHeader}>
        <div>
          <h2 id={titleId} className={styles.dialogTitle}>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className={styles.dialogDescription}>
              {description}
            </p>
          )}
        </div>
        <IconButton aria-label="Close" icon={<X size={18} />} size="sm" onClick={onClose} />
      </div>
      {children && <div className={styles.dialogBody}>{children}</div>}
      {footer && <div className={styles.dialogFooter}>{footer}</div>}
    </dialog>
  );
}
