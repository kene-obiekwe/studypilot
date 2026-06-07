"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LogIn, Sparkles, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { loginUser, registerUser } from "@/lib/api";
import { clearStoredToken, getStoredToken, setStoredToken } from "@/lib/session";

export default function AuthPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authState, setAuthState] = useState("No active session");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getStoredToken();
    if (token) {
      setAuthState("Authenticated");
      router.replace("/overview");
    }
  }, [router]);

  const onRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setAuthState("Creating account...");
    try {
      const response = await registerUser({ username, email, password });
      setAuthState(`Account created for ${response.username}.`);
    } catch (err) {
      setError((err as Error).message);
      setAuthState("Registration failed");
    }
  };

  const onLogin = async () => {
    setError("");
    setAuthState("Signing in...");
    try {
      const response = await loginUser({ username, password });
      setStoredToken(response.access);
      setAuthState("Authenticated");
      router.push("/overview");
    } catch (err) {
      setError((err as Error).message);
      setAuthState("Login failed");
    }
  };

  const onLogout = () => {
    clearStoredToken();
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

          <form className="form-grid" onSubmit={onRegister}>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label>
              Email
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
            New here? Register first; you will be redirected to the overview after a successful login.
          </p>
        </article>
      </section>
    </main>
  );
}
