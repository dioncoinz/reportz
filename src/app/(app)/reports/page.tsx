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

  if (profileLoading) return <p>Loading profile...</p>;

  if (!profile?.tenant_id) {
    return (
      <div>
        <h2>Your tenant is not set</h2>
        <p>
          In Supabase → Table Editor → <code>profiles</code>, set your{" "}
          <code>tenant_id</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Reports</h1>
        <Link href="/reports/new">+ New report</Link>
      </div>

      {loading ? <p>Loading reports...</p> : null}
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {reports.map((r) => (
          <div key={r.id} style={{ border: "1px solid #333", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 800 }}>{r.name}</div>
            <div style={{ opacity: 0.8, fontSize: 12 }}>
              {r.start_date ?? "?"} → {r.end_date ?? "?"} • {r.status}
            </div>
            <div style={{ marginTop: 8 }}>
              <Link href={`/reports/${r.id}`}>Open</Link>
            </div>
          </div>
        ))}
        {!loading && reports.length === 0 ? (
          <p style={{ opacity: 0.8 }}>No reports yet. Create your first one.</p>
        ) : null}
      </div>
    </div>
  );
}
