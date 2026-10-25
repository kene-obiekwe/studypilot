// Value of PHASE_PRODUCTION_BUILD from next/constants (require() is disallowed by the lint config).
const PHASE_PRODUCTION_BUILD = "phase-production-build";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // The old combined sign-in and sign-up page. Next keeps the query string on a redirect, so the
    // session-expiry link /auth?next=...&reason=expired lands on /sign-in with both values intact.
    return [{ source: "/auth", destination: "/sign-in", permanent: false }];
  },
};

module.exports = (phase) => {
  // NEXT_PUBLIC_* values are inlined at build time, so a production bundle built without the
  // API URL would silently call http://127.0.0.1:8000/api from every visitor's browser.
  // `next dev` keeps that localhost fallback; `next start` serves an already-built bundle.
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_API_BASE_URL?.trim()) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set. Production builds need the backend API URL, " +
        "e.g. NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api npm run build " +
        "(see frontend/.env.example).",
    );
  }
  return nextConfig;
};
