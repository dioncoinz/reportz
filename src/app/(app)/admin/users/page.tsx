"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";

type Role = "contributor" | "supervisor" | "manager";

export default function AdminUsersPage() {
  const supabase = createSupabaseBrowser();
  const { loading, profile } = useProfile();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("contributor");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function inviteUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setSaving(false);
      setMsg("You are not signed in.");
      return;
    }

    const res = await fetch("/api/admin/invite-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email,
        password,
        fullName,
        role,
      }),
    });

    const json = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setMsg(json.error ?? "Failed to create user.");
      return;
    }

    setEmail("");
    setPassword("");
    setFullName("");
    setRole("contributor");
    setMsg(`User created: ${json.user?.email ?? "unknown"}`);
  }

  if (loading) return <p className="muted">Loading...</p>;

  if (profile?.role !== "manager") {
    return <p className="muted">Only managers can access user admin.</p>;
  }

  return (
    <div className="section-card" style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: "0.8rem" }}>Admin: Invite User</h1>
      <form onSubmit={inviteUser} className="grid">
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label className="field">
          <span className="label">Temporary password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        <label className="field">
          <span className="label">Full name</span>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>

        <label className="field">
          <span className="label">Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="contributor">contributor</option>
            <option value="supervisor">supervisor</option>
            <option value="manager">manager</option>
          </select>
        </label>

        <button className="btn btn-primary" disabled={saving}>
          {saving ? "Creating..." : "Create user"}
        </button>

        {msg ? <p className={msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("not") ? "error-text" : "muted"}>{msg}</p> : null}
      </form>
    </div>
  );
}

