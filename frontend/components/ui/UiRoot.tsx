import type { HTMLAttributes } from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

/**
 * Wraps redesigned UI: sets the canvas, ink, font and the theme's color-scheme. Legacy pages
 * don't use it, so they keep their light-only look until they migrate.
 */
export function UiRoot({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx(styles.root, className)} />;
}
