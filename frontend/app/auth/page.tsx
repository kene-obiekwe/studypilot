import { redirect } from "next/navigation";

import { signInRedirectTarget } from "@/lib/auth-flow";

// The old combined sign-in and sign-up page. Kept as a redirect so existing links and the
// session-expiry redirect (/auth?next=...&reason=expired) still land on the sign-in screen.
export default async function AuthRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(signInRedirectTarget(await searchParams));
}
