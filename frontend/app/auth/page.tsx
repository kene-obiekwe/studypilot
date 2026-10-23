"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { KeyRound, LogIn, Sparkles, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginUser, registerUser, SESSION_EXPIRED_MESSAGE } from "@/lib/api";
import { clearSession, hasSession, setSession } from "@/lib/session";

// Only same-origin paths: "//host" and "/\host" would leave the site.
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/overview";
  }
  if (next === "/auth" || next.startsWith("/auth?") || next.startsWith("/auth/")) {
    return "/overview";
  }
  return next;
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm />
    </Suspense>
  );
}

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const target = safeNextPath(searchParams.get("next"));
  const expired = searchParams.get("reason") === "expired";
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authState, setAuthState] = useState("No active session");
  const [error, setError] = useState("");

  useEffect(() => {
    if (hasSession()) {
      setAuthState("Authenticated");
      router.replace(target);
    }
  }, [router, target]);

  const signIn = async () => {
    const tokens = await loginUser({ username, password });
    setSession(tokens);
    setAuthState("Authenticated");
    router.push(target);
  };

  const onRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setAuthState("Creating account...");
    let created = "";
    try {
      created = (await registerUser({ username, email, password })).username;
      setAuthState(`Account created for ${created}. Signing in...`);
      await signIn();
    } catch (err) {
      setError((err as Error).message);
      setAuthState(created ? `Account created for ${created}. Sign in to continue.` : "Registration failed");
    }
  };

  const onLogin = async () => {
    setError("");
    if (!username || !password) {
      setError("Enter your username and password to sign in.");
      return;
    }
    setAuthState("Signing in...");
    try {
      await signIn();
    } catch (err) {
      setError((err as Error).message);
      setAuthState("Login failed");
    }
  };

  const onLogout = () => {
    clearSession();
    setAuthState("No active session");
  };

  return (
    <main className="home-shell">
      <section className="hero animate-in">
        <span className="kicker">
          <Sparkles size={12} /> Step 1
        </span>
        <h2>Authentication</h2>
        <p>
          Create an account or sign in to unlock the workspace, generate plans, receive recommendations,
          and track adherence.
        </p>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <h3>
            <KeyRound size={16} /> Session access
          </h3>
          <p className="muted-text" style={{ marginTop: 4 }}>Current state: {authState}</p>

          {expired && <div className="notice info">{SESSION_EXPIRED_MESSAGE}</div>}

          <form className="form-grid" onSubmit={onRegister}>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label>
              Email (registration only)
              <input
                value={email}
                type="email"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                value={password}
                type="password"
                minLength={8}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            <div className="actions">
              <button type="submit">
                <UserPlus size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Register
              </button>
              <button type="button" className="secondary" onClick={() => void onLogin()}>
                <LogIn size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Login
              </button>
              <button type="button" className="ghost" onClick={onLogout}>
                Clear session
              </button>
            </div>
          </form>

          {error && <div className="notice error">{error}</div>}
        </article>

        <article className="card">
          <h3>
            <Sparkles size={16} /> What sits behind the login
          </h3>
          <ul>
            <li>JWT-secured workspace with planner, recommendations, and tracking APIs.</li>
            <li>Adherence model loaded on the backend and surfaced through a session-free predictor.</li>
            <li>Rule-based recommendation engine with heuristic confidence.</li>
            <li>Persisted history paginated across plans, recommendations, and sessions.</li>
          </ul>
          <p className="muted-text">
            New here? Register and you will be signed in and taken to the overview straight away.
          </p>
        </article>
      </section>
    </main>
  );
}
