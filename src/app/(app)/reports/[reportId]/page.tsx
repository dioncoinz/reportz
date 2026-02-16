"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import Link from "next/link";

type ReportRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_at: string;
};

export default function ReportDetailPage() {
  const supabase = createSupabaseBrowser();
  const params = useParams<{ reportId: string }>();
  const router = useRouter();

  const reportId = params?.reportId;
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!reportId) return;

      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("reports")
        .select("id, name, start_date, end_date, status, created_at")
        .eq("id", reportId)
        .single();

      if (error) {
        setErr(error.message);
        setReport(null);
      } else {
        setReport(data as ReportRow);
      }

      setLoading(false);
    }

    load();
  }, [reportId, supabase]);

  if (!reportId) return <p className="muted">Missing report id.</p>;
  if (loading) return <p className="muted">Loading report...</p>;

  if (err) {
    return (
      <div className="section-card" style={{ maxWidth: 760 }}>
        <h1>Report</h1>
        <p className="error-text" style={{ marginTop: "0.65rem" }}>
          {err}
        </p>
        <p className="muted">
          If this says no rows, the report id might be wrong. If it says permission denied, your profile
          tenant_id, role, or RLS may be blocking access.
        </p>
        <Link className="btn btn-soft" href="/reports">
          Back to reports
        </Link>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="section-card" style={{ maxWidth: 760 }}>
        <h1>Report not found</h1>
        <div style={{ marginTop: "0.8rem" }}>
          <Link className="btn btn-soft" href="/reports">
            Back to reports
          </Link>
        </div>
      </div>
    );
  }

  const statusClass =
    report.status === "complete" ? "status-complete" : report.status === "cancelled" ? "status-cancelled" : "status-open";

  return (
    <div className="grid" style={{ maxWidth: 920 }}>
      <div className="section-card grid">
        <div className="title-row">
          <div className="grid" style={{ gap: "0.45rem" }}>
            <h1>{report.name}</h1>
            <div className="muted">
              Dates: {report.start_date ?? "?"} {"->"} {report.end_date ?? "?"}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
            <span className={`status ${statusClass}`}>{report.status}</span>
            <button className="btn btn-soft" onClick={() => router.push("/reports")}>
              Back
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href={`/reports/${report.id}/import`}>
            Import Work Orders
          </Link>
          <Link className="btn btn-soft" href={`/reports/${report.id}/work-orders`}>
            Work Orders
          </Link>
          <Link className="btn btn-soft" href={`/reports/${report.id}/exports`}>
            Exports
          </Link>
          <button
            className="btn"
            onClick={() => window.open(`/api/export-report?reportId=${report.id}`, "_blank")}
          >
            Export Word
          </button>
        </div>
      </div>

      <div className="section-card muted">Track imports, updates, and exports for this shutdown report.</div>
    </div>
  );
}
