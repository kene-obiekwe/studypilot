"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./shell.module.css";

type SlotContextValue = { slot: HTMLElement | null; setSlot: (element: HTMLElement | null) => void };

const PageActionContext = createContext<SlotContextValue | null>(null);

/** Holds the DOM node of the top bar's action slot (set through a callback ref, not an effect). */
export function PageActionProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return <PageActionContext.Provider value={{ slot, setSlot }}>{children}</PageActionContext.Provider>;
}

/** Rendered by the top bar. Empty (and hidden) unless a page provides a PageAction. */
export function PageActionSlot() {
  const context = use(PageActionContext);
  return <div ref={context?.setSlot} className={styles.actionSlot} />;
}

/**
 * A page's single primary action, shown in the top bar next to the title.
 * Usage: <PageAction><Button variant="primary">Log a session</Button></PageAction>
 */
export function PageAction({ children }: { children: ReactNode }) {
  const context = use(PageActionContext);
  if (!context?.slot) return null;
  return createPortal(children, context.slot);
}
