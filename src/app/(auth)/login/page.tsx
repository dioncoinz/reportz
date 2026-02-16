"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createSupabaseBrowser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) setMsg(error.message);
    else window.location.href = "/reports";
  }

  return (
    <div className="container" style={{ padding: "3rem 0" }}>
      <div className="section-card" style={{ maxWidth: 460, margin: "0 auto" }}>
        <h1 style={{ marginBottom: "0.9rem" }}>Sign in</h1>

        <form onSubmit={onLogin} className="grid">
          <label className="field">
            <span className="label">Email</span>
            <input className="input" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>

          {msg ? <p className="error-text">{msg}</p> : null}
        </form>
      </div>
    </div>
  );
}
