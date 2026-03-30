"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LogIn, UserPlus } from "lucide-react";
import { loginUser, registerUser } from "@/lib/api";
import { clearStoredToken, getStoredToken, setStoredToken } from "@/lib/session";

export default function AuthPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authState, setAuthState] = useState("No active session");
  const [error, setError] = useState("");
  const [tokenPreview, setTokenPreview] = useState("");

  useEffect(() => {
    const token = getStoredToken();
    if (token) {
      setAuthState("Authenticated");
      setTokenPreview(token.slice(0, 22) + "...");
    }
  }, []);

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
      setTokenPreview(response.access.slice(0, 22) + "...");
      setAuthState("Authenticated");
    } catch (err) {
      setError((err as Error).message);
      setAuthState("Login failed");
    }
  };

  const onLogout = () => {
    clearStoredToken();
    setTokenPreview("");
    setAuthState("No active session");
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="hero">
        <span className="kicker">Step 1</span>
        <h2>Authentication</h2>
        <p>Create an account and sign in to use protected planning and AI recommendation endpoints.</p>
      </section>

      <article className="card">
        <h3>
          <KeyRound size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> Session Access
        </h3>
        <p>Current state: {authState}</p>

        <form className="form-grid" onSubmit={onRegister}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Email
            <input value={email} type="email" onChange={(e) => setEmail(e.target.value)} required />
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
              <UserPlus size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Register
            </button>
            <button type="button" className="secondary" onClick={() => void onLogin()}>
              <LogIn size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Login
            </button>
            <button type="button" className="secondary" onClick={onLogout}>
              Clear Session
            </button>
          </div>
        </form>

        {tokenPreview && <div className="notice ok">Token: {tokenPreview}</div>}
        {error && <div className="notice error">{error}</div>}
      </article>
    </div>
  );
}
