"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export default function NewReportPage() {
  const supabase = createSupabaseBrowser();
  const [clientName, setClientName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function isMissingSiteNameColumn(error: { message?: string; code?: string } | null) {
    return Boolean(error?.message?.includes("site_name") || error?.code === "PGRST204");
  }

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

    const baseReport = {
      tenant_id: profile.tenant_id,
      name: `${clientName.trim()} ${name.trim()}`.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      created_by: user.id,
      status: "draft",
    };

    let { data, error } = await supabase
      .from("reports")
      .insert({
        ...baseReport,
        site_name: siteName.trim() || null,
      })
      .select("id")
      .single();

    if (isMissingSiteNameColumn(error)) {
      const fallback = await supabase.from("reports").insert(baseReport).select("id").single();
      data = fallback.data;
      error = fallback.error;
    }

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    if (!data) {
      setMsg("Report was created, but Supabase did not return its id.");
      return;
    }

    window.location.href = `/reports/${data.id}`;
  }

  return (
    <div className="section-card" style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: "0.8rem" }}>New report</h1>

      <form onSubmit={createReport} className="grid">
        <label className="field">
          <span className="label">Client name</span>
          <input
            className="input"
            placeholder="Valeron"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        </label>

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
          <span className="label">Site name</span>
          <input
            className="input"
            placeholder="North Plant"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
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
