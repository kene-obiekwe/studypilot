import type { HTMLAttributes, ReactNode } from "react";

import { courseColor } from "../../lib/course-colors";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type BadgeTone = "neutral" | "accent" | "exam" | "success" | "danger" | "course";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** For tone="course": the course whose colour to use. */
  courseId?: number;
  icon?: ReactNode;
};

const TONES: Record<BadgeTone, string> = {
  neutral: styles.badgeNeutral,
  accent: styles.badgeAccent,
  exam: styles.badgeExam,
  success: styles.badgeSuccess,
  danger: styles.badgeDanger,
  course: styles.badgeCourse,
};

/** A small pill for status and counts, e.g. "Exam in 18 days" or "Forecast 76%". */
export function Badge({ tone = "neutral", courseId, icon, className, style, children, ...props }: BadgeProps) {
  const courseStyle = tone === "course" && courseId !== undefined ? courseColor(courseId).style : undefined;
  return (
    <span {...props} style={{ ...courseStyle, ...style }} className={cx(styles.badge, TONES[tone], className)}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

/** The course colour dot shown next to a course name. Decorative: the name carries the meaning. */
export function CourseDot({ courseId, className }: { courseId: number; className?: string }) {
  return <span aria-hidden="true" style={courseColor(courseId).style} className={cx(styles.dot, className)} />;
}
