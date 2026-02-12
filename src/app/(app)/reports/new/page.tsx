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

    // Fetch profile to get tenant_id (client-side)
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
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>New report</h1>
      <form onSubmit={createReport} style={{ display: "grid", gap: 12 }}>
        <input
          placeholder="Shutdown name (e.g., Y26 Wk04 Mill Shutdown)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 10 }}
          required
        />
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Start date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: 10 }} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>End date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: 10 }} />
        </label>

        <button disabled={loading} style={{ padding: 10, fontWeight: 800 }}>
          {loading ? "Creating..." : "Create report"}
        </button>

        {msg ? <p style={{ color: "tomato" }}>{msg}</p> : null}
      </form>
    </div>
  );
}
