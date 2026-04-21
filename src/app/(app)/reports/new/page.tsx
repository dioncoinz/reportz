"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export default function NewReportPage() {
  const supabase = createSupabaseBrowser();
  const [clientName, setClientName] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [keyPersonnel, setKeyPersonnel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function isMissingColumn(error: { message?: string; code?: string } | null, column: string) {
    return Boolean(error?.message?.includes(column) || error?.code === "PGRST204");
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

    const optionalReportFields = {
      key_personnel: keyPersonnel.trim() || null,
    };
    let insertPayload: Record<string, string | null> = optionalReportFields;
    let data: { id: string } | null = null;
    let error: { message?: string; code?: string } | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await supabase
        .from("reports")
        .insert({
          ...baseReport,
          ...insertPayload,
        })
        .select("id")
        .single();

      data = result.data;
      error = result.error;

      if (!error) break;

      const nextPayload = { ...insertPayload };
      if (isMissingColumn(error, "key_personnel")) delete nextPayload.key_personnel;
      if (Object.keys(nextPayload).length === Object.keys(insertPayload).length) break;
      insertPayload = nextPayload;
    }

    setLoading(false);

    if (error) {
      setMsg(error.message ?? "Failed to create report.");
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
          <span className="label">Start date</span>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>

        <label className="field">
          <span className="label">End date</span>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>

        <label className="field">
          <span className="label">Key personnel (shown on export front page)</span>
          <textarea
            className="textarea"
            value={keyPersonnel}
            onChange={(e) => setKeyPersonnel(e.target.value)}
            rows={4}
            placeholder="Enter key personnel names/roles (one per line or comma separated)"
          />
        </label>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Creating..." : "Create report"}
        </button>

        {msg ? <p className="error-text">{msg}</p> : null}
      </form>
    </div>
  );
}
