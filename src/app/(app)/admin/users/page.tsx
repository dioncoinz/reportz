"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { AppRole } from "@/lib/roles";
import { canAccessUserAdmin, canAssignRole, isOwner } from "@/lib/roles";

export default function AdminUsersPage() {
  const supabase = createSupabaseBrowser();
  const { loading, profile } = useProfile();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AppRole>("contributor");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function roleLabel(value: AppRole) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

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

    if (!canAssignRole(profile?.role, role)) {
      setSaving(false);
      setMsg("You do not have permission to assign that role.");
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

  if (!canAccessUserAdmin(profile?.role)) {
    return <p className="muted">Only supervisors, managers, and owners can access user admin.</p>;
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
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
            <option value="contributor">{roleLabel("contributor")}</option>
            {canAssignRole(profile?.role, "supervisor") ? <option value="supervisor">{roleLabel("supervisor")}</option> : null}
            {canAssignRole(profile?.role, "manager") ? <option value="manager">{roleLabel("manager")}</option> : null}
            {isOwner(profile?.role) ? <option value="owner">{roleLabel("owner")}</option> : null}
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

