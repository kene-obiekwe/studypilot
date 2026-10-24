import type { CSSProperties } from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type SkeletonProps = {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: "sm" | "md" | "lg" | "pill";
  className?: string;
};

/**
 * A loading placeholder. Hidden from assistive tech: mark the loading region with aria-busy and
 * a text alternative instead. The shimmer stops under prefers-reduced-motion.
 */
export function Skeleton({ width = "100%", height = 14, radius = "sm", className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, className)}
      style={{ width, height, borderRadius: `var(--sp-radius-${radius})` }}
    />
  );
}
