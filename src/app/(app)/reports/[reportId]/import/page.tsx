"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

export default function ImportPage() {
  const { reportId } = useParams<{ reportId: string }>();

  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function upload() {
    if (!file) return;

    setLoading(true);
    setMsg(null);

    const form = new FormData();
    form.append("file", file);
    form.append("reportId", reportId);

    const res = await fetch("/api/import-work-orders", {
      method: "POST",
      body: form,
    });

    const json = await res.json();

    setLoading(false);

    if (!res.ok) {
      setMsg(json.error);
    } else {
      setMsg(`✅ Imported ${json.inserted} work orders`);
    }
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <h1>Import Work Orders</h1>

      <p>Excel format must be:</p>

      <pre>
WO Number | Title
12345     | Replace Pump
67890     | Inspect Conveyor
      </pre>

      <input
        type="file"
        accept=".xlsx"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <div style={{ marginTop: 12 }}>
        <button onClick={upload} disabled={!file || loading}>
          {loading ? "Uploading..." : "Upload"}
        </button>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
