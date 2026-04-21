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
  const [vendorKeyContacts, setVendorKeyContacts] = useState("");
  const [clientKeyContacts, setClientKeyContacts] = useState("");
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

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setLoading(false);
      setMsg("Not signed in.");
      return;
    }

    const res = await fetch("/api/create-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        clientName,
        siteName,
        shutdownName: name,
        startDate,
        endDate,
        vendorKeyContacts,
        clientKeyContacts,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };

    setLoading(false);

    if (!res.ok) {
      setMsg(data.error ?? "Failed to create report.");
      return;
    }

    if (!data.id) {
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

        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <label className="field">
            <span className="label">Vendor key contacts</span>
            <textarea
              className="textarea"
              value={vendorKeyContacts}
              onChange={(e) => setVendorKeyContacts(e.target.value)}
              rows={4}
              placeholder="Enter vendor names/roles, one per line"
            />
          </label>

          <label className="field">
            <span className="label">Client key contacts</span>
            <textarea
              className="textarea"
              value={clientKeyContacts}
              onChange={(e) => setClientKeyContacts(e.target.value)}
              rows={4}
              placeholder="Enter client names/roles, one per line"
            />
          </label>
        </div>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Creating..." : "Create report"}
        </button>

        {msg ? <p className="error-text">{msg}</p> : null}
      </form>
    </div>
  );
}
