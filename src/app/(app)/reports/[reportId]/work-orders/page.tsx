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
  cancelled_reason: string | null;
  completed_at: string | null;
  created_at: string;
};

export default function WorkOrdersPage() {
  const supabase = createSupabaseBrowser();
  const { reportId } = useParams<{ reportId: string }>();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("work_orders")
      .select("id, wo_number, title, status, cancelled_reason, completed_at, created_at")
      .eq("report_id", reportId)
      .order("wo_number", { ascending: true });

    if (error) setErr(error.message);
    else setWorkOrders((data ?? []) as WorkOrder[]);

    setLoading(false);
  }

  useEffect(() => {
    if (reportId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

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
        </div>
      </div>

      {loading ? <p className="muted">Loading...</p> : null}
      {err ? <p className="error-text">{err}</p> : null}

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
