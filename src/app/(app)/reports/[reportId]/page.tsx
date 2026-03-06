"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import Link from "next/link";
import { useProfile } from "@/lib/useProfile";
import { canAccessExportSettings, canExportPowerPoint, hasManagerAccess } from "@/lib/roles";

type ReportRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  safety_injuries: number | null;
  safety_incidents: number | null;
  status: string;
  created_at: string;
};
type WorkOrderStatusRow = {
  status: "open" | "complete" | "cancelled";
  emergent_work: boolean;
};
const ARCHIVE_PREFIX = "[ARCHIVED] ";

function isArchivedReport(r: ReportRow) {
  return r.name.startsWith(ARCHIVE_PREFIX);
}

function displayReportName(name: string) {
  return name.startsWith(ARCHIVE_PREFIX) ? name.slice(ARCHIVE_PREFIX.length).trim() : name;
}

function getErrorMessage(err: unknown) {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "";
}

function isMissingColumnError(err: unknown, column: string) {
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
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
  const [woProgress, setWoProgress] = useState<WorkOrderStatusRow[]>([]);
  const [safetyInjuries, setSafetyInjuries] = useState("0");
  const [safetyIncidents, setSafetyIncidents] = useState("0");
  const [savingSafety, setSavingSafety] = useState(false);
  const [safetyMsg, setSafetyMsg] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!reportId) return;

      setLoading(true);
      setErr(null);

      const reportWithSafety = await supabase
        .from("reports")
        .select("id, name, start_date, end_date, safety_injuries, safety_incidents, status, created_at")
        .eq("id", reportId)
        .single();
      let data: ReportRow | null = null;
      let error: { message: string } | null = null;

      if (reportWithSafety.error) {
        if (
          isMissingColumnError(reportWithSafety.error, "safety_injuries") ||
          isMissingColumnError(reportWithSafety.error, "safety_incidents")
        ) {
          const fallback = await supabase
            .from("reports")
            .select("id, name, start_date, end_date, status, created_at")
            .eq("id", reportId)
            .single<Omit<ReportRow, "safety_injuries" | "safety_incidents">>();
          if (fallback.error || !fallback.data) {
            error = { message: fallback.error?.message ?? "Report not found" };
          } else {
            data = { ...fallback.data, safety_injuries: 0, safety_incidents: 0 };
          }
        } else {
          error = { message: reportWithSafety.error.message };
        }
      } else if (reportWithSafety.data) {
        data = reportWithSafety.data as ReportRow;
      }
      const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      let woData: WorkOrderStatusRow[] = [];
      if (!sessionErr && token) {
        const woRes = await fetch(`/api/report-work-orders?reportId=${reportId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const woJson = await woRes.json().catch(() => ({}));
        if (woRes.ok) {
          woData = ((woJson.workOrders ?? []) as Array<{ status: "open" | "complete" | "cancelled"; emergent_work: boolean }>)
            .map((w) => ({ status: w.status, emergent_work: w.emergent_work }));
        }
      }

      if (error || !data) {
        setErr(error?.message ?? "Report not found.");
        setReport(null);
      } else {
        const typed = data as ReportRow;
        setReport(typed);
        setSafetyInjuries(String(Math.max(typed.safety_injuries ?? 0, 0)));
        setSafetyIncidents(String(Math.max(typed.safety_incidents ?? 0, 0)));
        setWoProgress(woData);
      }

      setLoading(false);
    }

    load();
  }, [reportId, supabase]);

  async function archiveCurrentReport() {
    if (!report || !hasManagerAccess(profile?.role)) return;

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
    if (!report || !hasManagerAccess(profile?.role)) return;

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

  async function saveSafetyCompliance() {
    if (!report) return;
    setSavingSafety(true);
    setSafetyMsg(null);

    const injuries = Math.max(Number.parseInt(safetyInjuries || "0", 10) || 0, 0);
    const incidents = Math.max(Number.parseInt(safetyIncidents || "0", 10) || 0, 0);

    const { error } = await supabase
      .from("reports")
      .update({
        safety_injuries: injuries,
        safety_incidents: incidents,
      })
      .eq("id", report.id);

    setSavingSafety(false);
    if (error) {
      setSafetyMsg(`Save failed: ${error.message}`);
      return;
    }

    setReport({ ...report, safety_injuries: injuries, safety_incidents: incidents });
    setSafetyMsg("Safety compliance saved");
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
  const total = woProgress.length;
  const completed = woProgress.filter((w) => w.status === "complete").length;
  const cancelled = woProgress.filter((w) => w.status === "cancelled").length;
  const emergent = woProgress.filter((w) => w.emergent_work).length;
  const open = total - completed - cancelled;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

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
          {canAccessExportSettings(profile?.role) ? (
            <Link className="btn btn-soft" href={`/reports/${report.id}/exports`}>
              Exports
            </Link>
          ) : null}
          {canExportPowerPoint(profile?.role) ? (
            <button
              className="btn"
              onClick={() => window.open(`/api/export-report?reportId=${report.id}`, "_blank")}
            >
              Export PowerPoint
            </button>
          ) : null}
          {hasManagerAccess(profile?.role) && !isArchivedReport(report) ? (
            <button className="btn btn-danger" onClick={archiveCurrentReport} disabled={archiving}>
              {archiving ? "Archiving..." : "Archive report"}
            </button>
          ) : null}
          {hasManagerAccess(profile?.role) ? (
            <button className="btn btn-danger" onClick={deleteCurrentReport} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete report"}
            </button>
          ) : null}
        </div>

        <div className="title-row" style={{ alignItems: "center" }}>
          <div className="muted" style={{ fontSize: "0.9rem" }}>
            {completed} complete | {open} open | {cancelled} cancelled | {emergent} emergent | {total} total
          </div>
          <div className="muted" style={{ fontSize: "0.9rem", fontWeight: 600 }}>
            {pct}% complete
          </div>
        </div>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="section-card muted">Track imports, updates, and exports for this shutdown report.</div>
      <div className="section-card grid" style={{ gap: "0.65rem" }}>
        <h3>Safety Compliance</h3>
        <div style={{ display: "grid", gap: "0.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label className="field">
            <span className="label">Injuries</span>
            <input
              className="input"
              type="number"
              min={0}
              value={safetyInjuries}
              onChange={(e) => setSafetyInjuries(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Incidents</span>
            <input
              className="input"
              type="number"
              min={0}
              value={safetyIncidents}
              onChange={(e) => setSafetyIncidents(e.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={saveSafetyCompliance} disabled={savingSafety}>
            {savingSafety ? "Saving..." : "Save safety compliance"}
          </button>
          {safetyMsg ? <span className={safetyMsg.toLowerCase().includes("failed") ? "error-text" : "muted"}>{safetyMsg}</span> : null}
        </div>
      </div>
    </div>
  );
}

