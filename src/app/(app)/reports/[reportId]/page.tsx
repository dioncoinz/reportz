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
<button
  onClick={() =>
    window.open(`/api/export-report?reportId=${report.id}`, "_blank")
  }
>
  Export Word Report
</button>
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

  if (!reportId) return <p>Missing report id.</p>;
  if (loading) return <p>Loading report...</p>;

  if (err) {
    return (
      <div>
        <h1>Report</h1>
        <p style={{ color: "tomato" }}>{err}</p>
        <p style={{ opacity: 0.8 }}>
          If this says “No rows”, the report id might be wrong. If it says “permission denied”,
          your profile tenant_id/role or RLS might be blocking access.
        </p>
        <Link href="/reports">Back to reports</Link>
      </div>
    );
  }

  if (!report) {
    return (
      <div>
        <h1>Report not found</h1>
        <Link href="/reports">Back to reports</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>{report.name}</h1>
        <button onClick={() => router.push("/reports")}>Back</button>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        <div>
          Dates: {report.start_date ?? "?"} → {report.end_date ?? "?"}
        </div>
        <div>Status: {report.status}</div>
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href={`/reports/${report.id}/import`}>Import Work Orders</Link>
        <Link href={`/reports/${report.id}/work-orders`}>Work Orders</Link>
        <Link href={`/reports/${report.id}/exports`}>Exports</Link>
      </div>

      <div style={{ marginTop: 18, padding: 12, border: "1px solid #333", borderRadius: 10 }}>
        <strong>Next:</strong> we’ll add pages for Import / Work Orders / Exports.
      </div>
    </div>
  );
}
