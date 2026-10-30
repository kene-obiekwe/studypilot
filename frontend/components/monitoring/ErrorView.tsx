"use client";

import { useSyncExternalStore } from "react";
import { Compass, TriangleAlert } from "lucide-react";

import { Button, UiRoot } from "@/components/ui";
import { hasSession } from "@/lib/session";

import styles from "./ErrorView.module.css";

// Never changes while the page is open, so there is nothing to subscribe to.
const noSubscription = () => () => undefined;

/** Signed in people go back to their week; everyone else (and the server render) to the landing page. */
function useHomeHref(): string {
  return useSyncExternalStore(noSubscription, () => (hasSession() ? "/home" : "/"), () => "/");
}

export type ErrorViewProps = {
  title: string;
  description: string;
  /** Called by "Try again". Leave out where trying again means nothing (a missing page). */
  onTryAgain?: () => void;
  /** A short code that can be matched to a server log. Never an error message. */
  reference?: string;
  /** "page" fills the screen; "inline" sits inside the app shell. */
  layout?: "page" | "inline";
  /** "alert" (a warning triangle) for something that broke; "compass" for a page that isn't there. A name, not a component, so a server page can pass it. */
  icon?: "alert" | "compass";
};

/**
 * What the error pages and the not-found page show. It never prints an error message or stack: those go to
 * error tracking, not to the person looking at the screen. A plain link goes home so a full page load resets
 * whatever state caused the problem.
 */
export function ErrorView({ title, description, onTryAgain, reference, layout = "page", icon = "alert" }: ErrorViewProps) {
  const homeHref = useHomeHref();
  const Icon = icon === "compass" ? Compass : TriangleAlert;
  const panel = (
    <section className={styles.panel}>
      <Icon size={28} className={styles.icon} aria-hidden="true" />
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.text}>{description}</p>
      {reference && <p className={styles.reference}>Reference: {reference}</p>}
      <div className={styles.actions}>
        {onTryAgain && (
          <Button variant="primary" onClick={onTryAgain}>
            Try again
          </Button>
        )}
        {/* A full page load on purpose: after a crash, client navigation may be what is broken. */}
        <a href={homeHref} className={styles.link}>
          Go to home
        </a>
      </div>
    </section>
  );
  return layout === "page" ? <UiRoot className={styles.page}>{panel}</UiRoot> : <div className={styles.inline}>{panel}</div>;
}

/** The digest Next attaches to server errors, when there is one. */
export function errorReference(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    return typeof digest === "string" && digest ? digest : undefined;
  }
  return undefined;
}
