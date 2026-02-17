"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import Link from "next/link";
import { useProfile } from "@/lib/useProfile";

type ReportRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_at: string;
};
const ARCHIVE_PREFIX = "[ARCHIVED] ";

function isArchivedReport(r: ReportRow) {
  return r.name.startsWith(ARCHIVE_PREFIX);
}

function displayReportName(name: string) {
  return name.startsWith(ARCHIVE_PREFIX) ? name.slice(ARCHIVE_PREFIX.length).trim() : name;
}

export default function ReportDetailPage() {
  const supabase = createSupabaseBrowser();
  const { profile } = useProfile();
  const params = useParams<{ reportId: string }>();
  const router = useRouter();

  const reportId = params?.reportId;
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  async function archiveCurrentReport() {
    if (!report || profile?.role !== "manager") return;

    const ok = window.confirm("Archive this report? You can still access it later.");
    if (!ok) return;

    setArchiving(true);
    setErr(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setErr("You are not signed in.");
      setArchiving(false);
      return;
    }

    const res = await fetch("/api/archive-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reportId: report.id }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(json.error ?? "Failed to archive report.");
      setArchiving(false);
      return;
    }

    setReport({ ...report, name: `${ARCHIVE_PREFIX}${displayReportName(report.name)}` });
    setArchiving(false);
  }

  async function deleteCurrentReport() {
    if (!report || profile?.role !== "manager") return;

    const ok = window.confirm("Permanently delete this report and all related data? This cannot be undone.");
    if (!ok) return;

    setDeleting(true);
    setErr(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setErr("You are not signed in.");
      setDeleting(false);
      return;
    }

    const res = await fetch("/api/delete-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reportId: report.id }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(json.error ?? "Failed to delete report.");
      setDeleting(false);
      return;
    }

    router.push("/reports");
  }

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

  const statusClass = isArchivedReport(report)
    ? "status-archived"
    : report.status === "complete"
      ? "status-complete"
      : report.status === "cancelled"
      ? "status-cancelled"
      : "status-open";

  return (
    <div className="grid" style={{ maxWidth: 920 }}>
      <div className="section-card grid">
        <div className="title-row">
          <div className="grid" style={{ gap: "0.45rem" }}>
            <h1>{displayReportName(report.name)}</h1>
            <div className="muted">
              Dates: {report.start_date ?? "?"} {"->"} {report.end_date ?? "?"}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
            <span className={`status ${statusClass}`}>{isArchivedReport(report) ? "archived" : report.status}</span>
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
            Export PowerPoint
          </button>
          {profile?.role === "manager" && !isArchivedReport(report) ? (
            <button className="btn btn-danger" onClick={archiveCurrentReport} disabled={archiving}>
              {archiving ? "Archiving..." : "Archive report"}
            </button>
          ) : null}
          {profile?.role === "manager" ? (
            <button className="btn btn-danger" onClick={deleteCurrentReport} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete report"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="section-card muted">Track imports, updates, and exports for this shutdown report.</div>
    </div>
  );
}

