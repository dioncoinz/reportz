"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";

type ReportRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_at: string;
};

export default function ReportsPage() {
  const supabase = createSupabaseBrowser();
  const { loading: profileLoading, profile } = useProfile();

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function loadReports() {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("reports")
      .select("id, name, start_date, end_date, status, created_at")
      .order("created_at", { ascending: false });

    if (error) setErr(error.message);
    else setReports((data ?? []) as ReportRow[]);

    setLoading(false);
  }

  useEffect(() => {
    if (!profileLoading) loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading]);

  if (profileLoading) return <p className="muted">Loading profile...</p>;

  if (!profile?.tenant_id) {
    return (
      <div className="section-card" style={{ maxWidth: 720 }}>
        <h2>Your tenant is not set</h2>
        <p className="muted">
          In Supabase {"->"} Table Editor {"->"} <code>profiles</code>, set your <code>tenant_id</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ maxWidth: 920 }}>
      <div className="title-row">
        <h1>Reports</h1>
        <Link className="btn btn-primary" href="/reports/new">
          New report
        </Link>
      </div>

      {loading ? <p className="muted">Loading reports...</p> : null}
      {err ? <p className="error-text">{err}</p> : null}

      <div className="grid">
        {reports.map((r) => (
          <div key={r.id} className="section-card">
            <div className="title-row">
              <h3>{r.name}</h3>
              <span className={`status status-${r.status === "complete" ? "complete" : r.status === "cancelled" ? "cancelled" : "open"}`}>
                {r.status}
              </span>
            </div>

            <p className="muted" style={{ margin: "0.5rem 0 0" }}>
              {r.start_date ?? "?"} {"->"} {r.end_date ?? "?"}
            </p>

            <div style={{ marginTop: "0.9rem" }}>
              <Link className="btn btn-soft" href={`/reports/${r.id}`}>
                Open report
              </Link>
            </div>
          </div>
        ))}

        {!loading && reports.length === 0 ? <p className="muted">No reports yet. Create your first one.</p> : null}
      </div>
    </div>
  );
}
