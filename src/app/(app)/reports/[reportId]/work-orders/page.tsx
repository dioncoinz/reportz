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
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Work Orders</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href={`/reports/${reportId}`}>Report</Link>
          <Link href={`/reports/${reportId}/import`}>Import</Link>
        </div>
      </div>

      {loading ? <p>Loading…</p> : null}
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {workOrders.map((wo) => (
          <Link
            key={wo.id}
            href={`/reports/${reportId}/work-orders/${wo.id}`}
            style={{
              display: "block",
              padding: 12,
              border: "1px solid #333",
              borderRadius: 10,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ fontWeight: 900 }}>
              {wo.wo_number} — {wo.title}
            </div>
            <div style={{ opacity: 0.8, fontSize: 12 }}>
              Status: {wo.status}
              {wo.status === "cancelled" && wo.cancelled_reason ? ` • ${wo.cancelled_reason}` : ""}
            </div>
          </Link>
        ))}

        {!loading && workOrders.length === 0 ? (
          <p style={{ opacity: 0.8 }}>
            No work orders found. Import them first via{" "}
            <Link href={`/reports/${reportId}/import`}>Import</Link>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
