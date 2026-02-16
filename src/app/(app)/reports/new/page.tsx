"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export default function NewReportPage() {
  const supabase = createSupabaseBrowser();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createReport(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) {
      setLoading(false);
      setMsg("Not signed in.");
      return;
    }

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (pErr || !profile?.tenant_id) {
      setLoading(false);
      setMsg("Profile tenant_id not set.");
      return;
    }

    const { data, error } = await supabase
      .from("reports")
      .insert({
        tenant_id: profile.tenant_id,
        name,
        start_date: startDate || null,
        end_date: endDate || null,
        created_by: user.id,
        status: "draft",
      })
      .select("id")
      .single();

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    window.location.href = `/reports/${data.id}`;
  }

  return (
    <div className="section-card" style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: "0.8rem" }}>New report</h1>

      <form onSubmit={createReport} className="grid">
        <label className="field">
          <span className="label">Shutdown name</span>
          <input
            className="input"
            placeholder="Y26 Wk04 Mill Shutdown"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="label">Start date</span>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>

        <label className="field">
          <span className="label">End date</span>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Creating..." : "Create report"}
        </button>

        {msg ? <p className="error-text">{msg}</p> : null}
      </form>
    </div>
  );
}
