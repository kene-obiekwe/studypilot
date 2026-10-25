/** Pure helpers for the sign-in, sign-up, verification and password-reset screens. */

export const DEFAULT_AFTER_SIGN_IN = "/home";
export const CODE_LENGTH = 6;
export const RESEND_COOLDOWN_SECONDS = 60;

// The auth screens themselves are never a valid place to land after signing in.
const AUTH_PATHS = ["/auth", "/sign-in", "/sign-up", "/verify-email", "/forgot-password"];

/**
 * A `next` value is only followed when it is a same-origin path. Anything that a browser could read
 * as another site ("//host", "/\host", a path with control characters or backslashes) falls back.
 */
export function safeNextPath(next: string | null | undefined, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return fallback;
  }
  // Browsers drop tabs and newlines and treat "\" like "/", so "/\t/host" would mean "//host".
  if (/[\u0000-\u001f\u007f\\]/.test(next)) {
    return fallback;
  }
  const path = next.split(/[?#]/, 1)[0];
  if (AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))) {
    return fallback;
  }
  return next;
}

/** Keep only digits, at most CODE_LENGTH of them. Handles typing, pasting "123 456" and "123-456". */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** Whole seconds until a resend is allowed; 0 once `readyAt` has passed. Times are epoch milliseconds. */
export function resendSecondsLeft(readyAt: number, now: number): number {
  return Math.max(0, Math.ceil((readyAt - now) / 1000));
}

export function resendReadyAt(now: number, cooldownSeconds: number = RESEND_COOLDOWN_SECONDS): number {
  return now + cooldownSeconds * 1000;
}

/** A link to another auth screen that carries `next` along, so it survives sign-up and verification. */
export function authLink(path: string, params: { next?: string | null; email?: string | null; sent?: boolean } = {}): string {
  const query = new URLSearchParams();
  if (params.email) {
    query.set("email", params.email);
  }
  if (params.sent) {
    query.set("sent", "1");
  }
  if (params.next) {
    query.set("next", params.next);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
