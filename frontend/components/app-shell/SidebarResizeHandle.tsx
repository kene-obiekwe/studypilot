"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_KEY_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/sidebar";

import styles from "./shell.module.css";

type Props = {
  /** The sidebar's current width in px. */
  width: number;
  /** id of the sidebar this handle resizes. */
  controls: string;
  /** Live width while dragging (not yet saved). */
  onResize: (width: number) => void;
  /** Final width: drag released, arrow key, Home/End or a double-click reset. Save it. */
  onCommit: (width: number) => void;
  /** True while a pointer drag is in progress (the shell turns off its width transition). */
  onDraggingChange: (dragging: boolean) => void;
};

/**
 * The drag handle on the sidebar's right edge (the WAI-ARIA window splitter pattern): drag it,
 * or focus it and use the arrow keys, Home and End. A double-click restores the default width.
 */
export function SidebarResizeHandle({ width, controls, onResize, onCommit, onDraggingChange }: Props) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; last: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, last: width };
    onDraggingChange(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = clampSidebarWidth(current.startWidth + event.clientX - current.startX);
    if (next === current.last) return;
    current.last = next;
    onResize(next);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onDraggingChange(false);
    onCommit(current.last);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = width - SIDEBAR_KEY_STEP;
    else if (event.key === "ArrowRight") next = width + SIDEBAR_KEY_STEP;
    else if (event.key === "Home") next = SIDEBAR_MIN_WIDTH;
    else if (event.key === "End") next = SIDEBAR_MAX_WIDTH;
    if (next === null) return;
    event.preventDefault();
    onCommit(clampSidebarWidth(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className={styles.resizeHandle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onCommit(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={onKeyDown}
    />
  );
}
