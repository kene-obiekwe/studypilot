/**
 * Browser error tracking with Sentry, errors only. Off unless NEXT_PUBLIC_SENTRY_DSN is set at build time.
 *
 * What is sent is the error, its stack and the page address without query string or fragment. Never sent:
 * user details, cookies, request bodies, performance traces or session replays. The SDK is loaded on demand,
 * so a site without a DSN downloads none of it and a site with one is not delayed by it.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/browser";

type Sentry = typeof import("@sentry/browser");

let sdk: Promise<Sentry | null> | null = null;

function dsn(): string {
  return (process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
}

function environment(): string {
  return (
    (process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "").trim() ||
    (process.env.NODE_ENV === "production" ? "production" : "development")
  );
}

/** The address without its query string (codes, tokens in links) and fragment. */
export function stripUrl(url: string): string {
  return url.split("#", 1)[0].split("?", 1)[0];
}

function stripUrlField(data: Record<string, unknown> | undefined, key: string): void {
  const value = data?.[key];
  if (data && typeof value === "string") {
    data[key] = stripUrl(value);
  }
}

function cleanBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  for (const key of ["url", "from", "to"]) {
    stripUrlField(data, key);
  }
  return breadcrumb;
}

/** Removes personal data from an event before it leaves the browser. Never drops the event. */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (request) {
    if (typeof request.url === "string") {
      request.url = stripUrl(request.url);
    }
    delete request.query_string;
    delete request.cookies;
    delete request.data;
    const headers = request.headers;
    if (headers) {
      for (const name of Object.keys(headers)) {
        if (/^(referer|cookie|authorization)$/i.test(name)) {
          delete headers[name];
        }
      }
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(cleanBreadcrumb);
  }
  delete event.user;
  return event;
}

/** Starts Sentry once, in the browser, and only with a DSN. Safe to call from anywhere, any number of times. */
export function initMonitoring(): void {
  if (sdk || typeof window === "undefined" || !dsn()) {
    return;
  }
  sdk = import("@sentry/browser")
    .then((Sentry) => {
      Sentry.init({
        dsn: dsn(),
        environment: environment(),
        sendDefaultPii: false,
        // Errors only: no tracing integration, no replay integration, no sample rates.
        beforeSend,
        beforeBreadcrumb: cleanBreadcrumb,
        // Click breadcrumbs name the element that was clicked, and console breadcrumbs repeat whatever was logged.
        integrations: (defaults) => [
          ...defaults.filter((item) => item.name !== "Breadcrumbs" && item.name !== "Console"),
          Sentry.breadcrumbsIntegration({ dom: false }),
        ],
      });
      return Sentry;
    })
    .catch(() => null);
}

/** Sends a caught error to Sentry. Does nothing without a DSN, and never throws. */
export function reportError(error: unknown): void {
  initMonitoring();
  void sdk?.then((Sentry) => Sentry?.captureException(error)).catch(() => undefined);
}
