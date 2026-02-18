"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { useSearchParams } from "next/navigation";

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

export default function ReportsPage() {
  const supabase = createSupabaseBrowser();
  const { loading: profileLoading, profile } = useProfile();
  const searchParams = useSearchParams();
  const archivedView = searchParams.get("view") === "archived";

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  async function archiveReport(reportId: string) {
    if (profile?.role !== "manager") return;

    const ok = window.confirm("Archive this report? You can still open it later, but it will be marked archived.");
    if (!ok) return;

    setArchivingId(reportId);
    setErr(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setArchivingId(null);
      setErr("You are not signed in.");
      return;
    }

    const res = await fetch("/api/archive-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reportId }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(json.error ?? "Failed to archive report.");
      setArchivingId(null);
      return;
    }

    await loadReports();
    setArchivingId(null);
  }

  async function deleteReport(reportId: string) {
    if (profile?.role !== "manager") return;

    const ok = window.confirm("Permanently delete this report and all its work orders/updates? This cannot be undone.");
    if (!ok) return;

    setDeletingId(reportId);
    setErr(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setDeletingId(null);
      setErr("You are not signed in.");
      return;
    }

    const res = await fetch("/api/delete-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reportId }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(json.error ?? "Failed to delete report.");
      setDeletingId(null);
      return;
    }

    await loadReports();
    setDeletingId(null);
  }

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
        <h1>{archivedView ? "Archived Reports" : "Reports"}</h1>
        <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
          <Link className={`btn ${!archivedView ? "btn-active" : "btn-soft"}`} href="/reports">
            Active
          </Link>
          <Link className={`btn ${archivedView ? "btn-active" : "btn-soft"}`} href="/reports?view=archived">
            Archived
          </Link>
          {!archivedView ? (
            <Link className="btn btn-primary" href="/reports/new">
              New report
            </Link>
          ) : null}
        </div>
      </div>

      {loading ? <p className="muted">Loading reports...</p> : null}
      {err ? <p className="error-text">{err}</p> : null}

      <div className="grid">
        {reports
          .filter((r) => (archivedView ? isArchivedReport(r) : !isArchivedReport(r)))
          .map((r) => (
          <div key={r.id} className="section-card">
            <div className="title-row">
              <h3>{displayReportName(r.name)}</h3>
              {(() => {
                const archived = isArchivedReport(r);
                return (
              <span
                className={`status status-${
                  archived
                    ? "archived"
                    : r.status === "complete"
                    ? "complete"
                    : r.status === "cancelled"
                    ? "cancelled"
                    : "open"
                }`}
              >
                {archived ? "archived" : r.status}
              </span>
                );
              })()}
            </div>

            <p className="muted" style={{ margin: "0.5rem 0 0" }}>
              {r.start_date ?? "?"} {"->"} {r.end_date ?? "?"}
            </p>

            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.55rem", flexWrap: "wrap", alignItems: "center" }}>
              <Link className="btn btn-soft" href={`/reports/${r.id}`}>
                Open report
              </Link>
              <div style={{ marginLeft: "auto", display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
                {profile?.role === "manager" && !isArchivedReport(r) ? (
                  <button className="btn btn-danger" disabled={archivingId === r.id} onClick={() => archiveReport(r.id)}>
                    {archivingId === r.id ? "Archiving..." : "Archive"}
                  </button>
                ) : null}
                {profile?.role === "manager" ? (
                  <button className="btn btn-danger" disabled={deletingId === r.id} onClick={() => deleteReport(r.id)}>
                    {deletingId === r.id ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}

        {!loading && reports.filter((r) => (archivedView ? isArchivedReport(r) : !isArchivedReport(r))).length === 0 ? (
          <p className="muted">
            {archivedView ? "No archived reports yet." : "No reports yet. Create your first one."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
