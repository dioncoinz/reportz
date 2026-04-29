"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import Link from "next/link";
import { useProfile } from "@/lib/useProfile";
import { isExportOwner } from "@/lib/export-access";

type ReportRow = {
  id: string;
  name: string;
  client_name: string | null;
  site_name: string | null;
  shutdown_name: string | null;
  start_date: string | null;
  end_date: string | null;
  key_personnel: string | null;
  vendor_key_contacts: string | null;
  client_key_contacts: string | null;
  status: string;
  created_at: string;
};
type WorkOrderStatusRow = {
  status: "open" | "complete" | "cancelled";
};
const ARCHIVE_PREFIX = "[ARCHIVED] ";

function isArchivedReport(r: ReportRow) {
  return r.name.startsWith(ARCHIVE_PREFIX);
}

function displayReportName(name: string) {
  return name.startsWith(ARCHIVE_PREFIX) ? name.slice(ARCHIVE_PREFIX.length).trim() : name;
}

function isMissingColumn(error: { message?: string; code?: string } | null, column: string) {
  return Boolean(error?.message?.includes(column) || error?.code === "PGRST204");
}

function splitLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function titleParts(report: ReportRow) {
  const client = report.client_name?.trim();
  const site = report.site_name?.trim();
  const shutdown = report.shutdown_name?.trim();
  if (client || shutdown) {
    return {
      clientName: client || "",
      siteName: site || "",
      shutdownName: shutdown || displayReportName(report.name),
    };
  }
  if (site) {
    const name = displayReportName(report.name).replace(/\s+/g, " ").trim();
    const siteIndex = name.toLowerCase().indexOf(site.toLowerCase());
    if (siteIndex >= 0) {
      const siteEnd = siteIndex + site.length;
      const clientSite = name.slice(0, siteEnd).trim();
      return {
        clientName: clientSite.slice(0, Math.max(0, clientSite.length - site.length)).replace(/\s+-\s*$/, "").trim(),
        siteName: site,
        shutdownName: name.slice(siteEnd).trim(),
      };
    }
  }
  return {
    clientName: "",
    siteName: site || "",
    shutdownName: displayReportName(report.name),
  };
}

export default function ReportDetailPage() {
  const supabase = createSupabaseBrowser();
  const { profile, userId } = useProfile();
  const params = useParams<{ reportId: string }>();
  const router = useRouter();

  const reportId = params?.reportId;
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [clientName, setClientName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [shutdownName, setShutdownName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [vendorKeyContacts, setVendorKeyContacts] = useState("");
  const [clientKeyContacts, setClientKeyContacts] = useState("");
  const [woProgress, setWoProgress] = useState<WorkOrderStatusRow[]>([]);
  const canManageExportTemplate = isExportOwner(userId);

  useEffect(() => {
    async function load() {
      if (!reportId) return;

      setLoading(true);
      setErr(null);

      const optionalReportColumns = [
        "client_name",
        "site_name",
        "shutdown_name",
        "key_personnel",
        "vendor_key_contacts",
        "client_key_contacts",
      ] as const;
      const missingReportColumns = new Set<(typeof optionalReportColumns)[number]>();
      let data: ReportRow | null = null;
      let error: { message?: string; code?: string } | null = null;

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const selectColumns = [
          "id",
          "name",
          missingReportColumns.has("client_name") ? null : "client_name",
          missingReportColumns.has("site_name") ? null : "site_name",
          missingReportColumns.has("shutdown_name") ? null : "shutdown_name",
          "start_date",
          "end_date",
          missingReportColumns.has("key_personnel") ? null : "key_personnel",
          missingReportColumns.has("vendor_key_contacts") ? null : "vendor_key_contacts",
          missingReportColumns.has("client_key_contacts") ? null : "client_key_contacts",
          "status",
          "created_at",
        ].filter(Boolean);

        const result = await supabase.from("reports").select(selectColumns.join(", ")).eq("id", reportId).single<ReportRow>();
        data = result.data
          ? {
              ...result.data,
              client_name: result.data.client_name ?? null,
              site_name: result.data.site_name ?? null,
              shutdown_name: result.data.shutdown_name ?? null,
              key_personnel: result.data.key_personnel ?? null,
              vendor_key_contacts: result.data.vendor_key_contacts ?? null,
              client_key_contacts: result.data.client_key_contacts ?? null,
            }
          : null;
        error = result.error;

        if (!error) break;

        let foundMissingOptional = false;
        for (const column of optionalReportColumns) {
          if (!missingReportColumns.has(column) && isMissingColumn(error, column)) {
            missingReportColumns.add(column);
            foundMissingOptional = true;
          }
        }
        if (!foundMissingOptional) break;
      }

      const { data: woData } = await supabase
        .from("work_orders")
        .select("status")
        .eq("report_id", reportId);

      if (error) {
        setErr(error.message ?? "Failed to load report.");
      
        setReport(null);
      } else {
        setReport(data);
        if (data) {
          const parts = titleParts(data);
          setClientName(parts.clientName);
          setSiteName(parts.siteName);
          setShutdownName(parts.shutdownName);
          setStartDate(data.start_date ?? "");
          setEndDate(data.end_date ?? "");
          setVendorKeyContacts(splitLines(data.vendor_key_contacts || data.key_personnel));
          setClientKeyContacts(splitLines(data.client_key_contacts));
        }
        setWoProgress((woData ?? []) as WorkOrderStatusRow[]);
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

  async function saveReportDetails() {
    if (!report || profile?.role !== "manager") return;
    const cleanedShutdownName = shutdownName.trim();
    if (!cleanedShutdownName) {
      setErr("Shutdown name is required.");
      return;
    }

    setSavingDetails(true);
    setErr(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setErr("You are not signed in.");
      setSavingDetails(false);
      return;
    }

    const res = await fetch("/api/update-report-details", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reportId: report.id,
        clientName,
        siteName,
        shutdownName: cleanedShutdownName,
        startDate,
        endDate,
        vendorKeyContacts,
        clientKeyContacts,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(typeof json?.error === "string" ? json.error : "Failed to update report details.");
      setSavingDetails(false);
      return;
    }

    const nextName = [[clientName.trim(), siteName.trim()].filter(Boolean).join(" - "), cleanedShutdownName]
      .filter(Boolean)
      .join(" ");
    setReport({
      ...report,
      name: isArchivedReport(report) ? `${ARCHIVE_PREFIX}${nextName}` : nextName,
      client_name: clientName.trim() || null,
      site_name: siteName.trim() || null,
      shutdown_name: cleanedShutdownName,
      start_date: startDate || null,
      end_date: endDate || null,
      vendor_key_contacts: vendorKeyContacts.trim() || null,
      client_key_contacts: clientKeyContacts.trim() || null,
      key_personnel: [vendorKeyContacts.trim(), clientKeyContacts.trim()].filter(Boolean).join("\n") || null,
    });
    setEditingDetails(false);
    setSavingDetails(false);
  }

  async function exportPowerPoint() {
    if (!report) return;

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setErr("You are not signed in.");
      return;
    }

    const res = await fetch(`/api/export-report?reportId=${report.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setErr(json.error ?? "Export failed.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${displayReportName(report.name)}.pptx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
          {canManageExportTemplate ? (
            <Link className="btn btn-soft" href={`/reports/${report.id}/exports`}>
              Exports
            </Link>
          ) : null}
          <button className="btn" onClick={exportPowerPoint}>
            Export PowerPoint
          </button>
          {profile?.role === "manager" ? (
            <button className="btn btn-soft" onClick={() => setEditingDetails((v) => !v)} disabled={savingDetails}>
              {editingDetails ? "Close details" : "Edit details"}
            </button>
          ) : null}
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

        {editingDetails ? (
          <div className="section-card grid" style={{ boxShadow: "none", gap: "0.75rem" }}>
            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label className="field">
                <span className="label">Client name</span>
                <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Site name</span>
                <input className="input" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
              </label>
            </div>

            <label className="field">
              <span className="label">Shutdown name</span>
              <input className="input" value={shutdownName} onChange={(e) => setShutdownName(e.target.value)} required />
            </label>

            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label className="field">
                <span className="label">Start date</span>
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">End date</span>
                <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>

            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label className="field">
                <span className="label">GMR Services key contacts</span>
                <textarea
                  className="textarea"
                  value={vendorKeyContacts}
                  onChange={(e) => setVendorKeyContacts(e.target.value)}
                  rows={4}
                />
              </label>
              <label className="field">
                <span className="label">Client key contacts</span>
                <textarea
                  className="textarea"
                  value={clientKeyContacts}
                  onChange={(e) => setClientKeyContacts(e.target.value)}
                  rows={4}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={saveReportDetails} disabled={savingDetails}>
                {savingDetails ? "Saving..." : "Save details"}
              </button>
              <button className="btn btn-soft" onClick={() => setEditingDetails(false)} disabled={savingDetails}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="title-row" style={{ alignItems: "center" }}>
          <div className="muted" style={{ fontSize: "0.9rem" }}>
            {completed} complete | {open} open | {cancelled} cancelled | {total} total
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
    </div>
  );
}

