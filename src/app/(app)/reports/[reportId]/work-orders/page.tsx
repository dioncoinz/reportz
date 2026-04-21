"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type WorkOrder = {
  id: string;
  wo_number: string;
  title: string;
  status: "open" | "complete" | "cancelled";
  emergent_work: boolean;
  cancelled_reason: string | null;
  completed_at: string | null;
  created_at: string;
};

export default function WorkOrdersPage() {
  const supabase = createSupabaseBrowser();
  const { reportId } = useParams<{ reportId: string }>();

  const [loading, setLoading] = useState(true);
  const [addingEmergent, setAddingEmergent] = useState(false);
  const [showEmergentForm, setShowEmergentForm] = useState(false);
  const [emergentWoNumber, setEmergentWoNumber] = useState("");
  const [emergentTitle, setEmergentTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (sessionErr || !token) {
      setErr("You are not signed in.");
      setLoading(false);
      return;
    }

    const res = await fetch(`/api/report-work-orders?reportId=${reportId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) setErr(json.error ?? "Failed to load work orders");
    else setWorkOrders((json.workOrders ?? []) as WorkOrder[]);

    setLoading(false);
  }

  useEffect(() => {
    if (reportId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  async function addEmergentWorkOrder() {
    const woNumber = emergentWoNumber.trim();
    const title = emergentTitle.trim();
    if (!woNumber) {
      setErr("WO Number is required for emergent work.");
      return;
    }

    setAddingEmergent(true);
    setErr(null);
    setMsg(null);

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (sessionErr || !token) {
      setErr("You are not signed in.");
      setAddingEmergent(false);
      return;
    }

    const res = await fetch("/api/emergent-work-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reportId, woNumber, title }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(json.error ?? "Failed to add emergent work order.");
      setAddingEmergent(false);
      return;
    }

    setEmergentWoNumber("");
    setEmergentTitle("");
    setMsg("Emergent work order added.");
    setAddingEmergent(false);
    await load();
  }

  return (
    <div className="grid" style={{ maxWidth: 940 }}>
      <div className="title-row">
        <h1>Work Orders</h1>
        <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
          <Link className="btn btn-soft" href={`/reports/${reportId}`}>
            Report
          </Link>
          <Link className="btn btn-primary" href={`/reports/${reportId}/import`}>
            Import
          </Link>
          <button
            className={`btn ${showEmergentForm ? "btn-active" : "btn-soft"}`}
            onClick={() => setShowEmergentForm((v) => !v)}
          >
            Add Emergent WO
          </button>
        </div>
      </div>

      {showEmergentForm ? (
        <div className="section-card grid" style={{ gap: "0.65rem" }}>
          <div className="title-row">
            <h3>Add Emergent WO</h3>
            <button className="btn btn-primary" onClick={addEmergentWorkOrder} disabled={addingEmergent}>
              {addingEmergent ? "Adding..." : "Add Emergent"}
            </button>
          </div>
          <div style={{ display: "grid", gap: "0.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <input
              className="input"
              placeholder="WO Number (required)"
              value={emergentWoNumber}
              onChange={(e) => setEmergentWoNumber(e.target.value)}
            />
            <input
              className="input"
              placeholder="WO Header / Title"
              value={emergentTitle}
              onChange={(e) => setEmergentTitle(e.target.value)}
            />
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Use this for emergent work orders that were not included in the original import file.
          </p>
        </div>
      ) : null}

      {loading ? <p className="muted">Loading...</p> : null}
      {err ? <p className="error-text">{err}</p> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="grid">
        {workOrders.map((wo) => (
          <Link key={wo.id} href={`/reports/${reportId}/work-orders/${wo.id}`} className="wo-list-item">
            <div className="title-row" style={{ alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {wo.wo_number} - {wo.title}
                </div>
                <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                  {wo.status === "cancelled" && wo.cancelled_reason
                    ? `Cancelled: ${wo.cancelled_reason}`
                    : "Tap to view details and updates"}
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {wo.emergent_work ? <span className="status status-emergent">emergent</span> : null}
                <span
                  className={`status ${
                    wo.status === "complete"
                      ? "status-complete"
                      : wo.status === "cancelled"
                      ? "status-cancelled"
                      : "status-open"
                  }`}
                >
                  {wo.status}
                </span>
              </div>
            </div>
          </Link>
        ))}

        {!loading && workOrders.length === 0 ? (
          <p className="muted">
            No work orders found. Import them first via <Link href={`/reports/${reportId}/import`}>Import</Link>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
