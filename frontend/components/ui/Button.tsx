import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shows a spinner, sets aria-busy and ignores clicks (and form submits); the label stays for screen readers.
   * It is not `disabled`: a disabled button drops keyboard focus, which would leave the user at the top of the
   * page the moment they activate it.
   */
  loading?: boolean;
  /** An icon before the label (decorative; give the button a text label). */
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, className, children, disabled, type = "button", onClick, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      className={cx(styles.control, styles.button, styles[variant], styles[size], className)}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        icon && (
          <span className={styles.buttonIcon} aria-hidden="true">
            {icon}
          </span>
        )
      )}
      {children}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, "icon" | "children" | "aria-label"> & {
  /** Required: an icon-only button has no visible text. */
  "aria-label": string;
  icon: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", icon, className, ...props },
  ref,
) {
  return (
    <Button {...props} ref={ref} variant={variant} size={size} className={cx(styles.iconButton, className)}>
      <span className={styles.buttonIcon} aria-hidden="true">
        {icon}
      </span>
    </Button>
  );
});
