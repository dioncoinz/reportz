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
      setMsg(`Imported ${json.inserted} work orders`);
    }
  }

  return (
    <div className="grid" style={{ maxWidth: 760 }}>
      <h1>Import Work Orders</h1>

      <div className="section-card grid">
        <p className="muted" style={{ margin: 0 }}>
          Excel format:
        </p>

        <pre
          style={{
            margin: 0,
            padding: "0.85rem",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--surface-soft)",
            overflowX: "auto",
          }}
        >
WO Number | Title
12345     | Replace Pump
67890     | Inspect Conveyor
        </pre>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <label className="btn btn-soft" style={{ cursor: "pointer" }}>
            Choose file
            <input
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file ? <span className="muted">{file.name}</span> : <span className="muted">No file selected</span>}
        </div>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={upload} disabled={!file || loading}>
            {loading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>

      {msg ? <p className={msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("error") ? "error-text" : "muted"}>{msg}</p> : null}
    </div>
  );
}
