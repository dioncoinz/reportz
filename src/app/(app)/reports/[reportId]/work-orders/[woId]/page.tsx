"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type WorkOrder = {
  id: string;
  report_id: string;
  wo_number: string;
  title: string;
  status: "open" | "complete" | "cancelled";
  cancelled_reason: string | null;
  completed_at: string | null;
};

type UpdateRow = {
  id: string;
  work_order_id: string;
  created_by: string;
  comment: string | null;
  photo_urls: string[];
  created_at: string;
};

export default function WorkOrderDetailPage() {
  const supabase = createSupabaseBrowser();
  const router = useRouter();
  const { reportId, woId } = useParams<{ reportId: string; woId: string }>();

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [allWos, setAllWos] = useState<Pick<WorkOrder, "id" | "status">[]>([]);

  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [signedMap, setSignedMap] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState("");

  async function load() {
    setLoading(true);
    setErr(null);

    const { data: woData, error: woErr } = await supabase
      .from("work_orders")
      .select("id, report_id, wo_number, title, status, cancelled_reason, completed_at")
      .eq("id", woId)
      .single();

    if (woErr) {
      setErr(woErr.message);
      setLoading(false);
      return;
    }

    const { data: allData, error: allErr } = await supabase
      .from("work_orders")
      .select("id, status")
      .eq("report_id", woData.report_id);

    if (!allErr) setAllWos((allData ?? []) as Pick<WorkOrder, "id" | "status">[]);

    const { data: updData, error: updErr } = await supabase
      .from("wo_updates")
      .select("id, work_order_id, created_by, comment, photo_urls, created_at")
      .eq("work_order_id", woId)
      .order("created_at", { ascending: false });

    if (updErr) setErr(updErr.message);

    setWo(woData as WorkOrder);
    setCancelReason(woData.cancelled_reason ?? "");
    setUpdates((updData ?? []) as UpdateRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (woId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  const allPhotoPaths = useMemo(() => {
    const paths: string[] = [];
    for (const u of updates) for (const p of u.photo_urls ?? []) paths.push(p);
    return Array.from(new Set(paths));
  }, [updates]);

  useEffect(() => {
    async function signMissing() {
      const next: Record<string, string> = { ...signedMap };
      const missing = allPhotoPaths.filter((p) => !next[p]);

      for (const path of missing) {
        const { data, error } = await supabase.storage.from("report-photos").createSignedUrl(path, 60 * 60);

        if (!error && data?.signedUrl) next[path] = data.signedUrl;
      }

      if (missing.length) setSignedMap(next);
    }

    signMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPhotoPaths]);

  const total = allWos.length;
  const completed = allWos.filter((w) => w.status === "complete").length;
  const cancelled = allWos.filter((w) => w.status === "cancelled").length;
  const open = total - completed - cancelled;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  async function updateStatus(status: WorkOrder["status"]) {
    if (!wo) return;

    const { error } = await supabase
      .from("work_orders")
      .update({
        status,
        completed_at: status === "complete" ? new Date().toISOString() : null,
        cancelled_reason: status !== "cancelled" ? null : wo.cancelled_reason,
      })
      .eq("id", wo.id);

    if (error) {
      setErr(error.message);
      return;
    }

    await load();
  }

  async function saveReason(reason: string) {
    if (!wo) return;

    const { error } = await supabase.from("work_orders").update({ cancelled_reason: reason }).eq("id", wo.id);

    if (error) {
      setErr(error.message);
      return;
    }

    setWo({ ...wo, cancelled_reason: reason });
    setMsg("Reason saved");
  }

  async function addUpdate() {
    setSaving(true);
    setMsg(null);
    setErr(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const user = userRes.user;

    if (userErr || !user) {
      setSaving(false);
      setErr("You are not signed in.");
      return;
    }

    const photoPaths: string[] = [];

    for (const file of files) {
      const safeName = file.name.replace(/\s+/g, "_");
      const path = `${reportId}/${woId}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage.from("report-photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (upErr) {
        setSaving(false);
        setErr(`Photo upload failed: ${upErr.message}`);
        return;
      }

      photoPaths.push(path);
    }

    const { error: insErr } = await supabase.from("wo_updates").insert({
      work_order_id: woId,
      created_by: user.id,
      comment: comment.trim() || null,
      photo_urls: photoPaths,
    });

    if (insErr) {
      setSaving(false);
      setErr(insErr.message);
      return;
    }

    setComment("");
    setFiles([]);
    setMsg("Update added");
    setSaving(false);
    await load();
  }

  if (loading) return <p className="muted">Loading...</p>;

  if (err) {
    return (
      <div className="section-card" style={{ maxWidth: 900 }}>
        <p className="error-text">{err}</p>
        <button className="btn btn-soft" onClick={() => router.back()}>
          Back
        </button>
      </div>
    );
  }

  if (!wo) return <p className="muted">Not found.</p>;

  const statusClass =
    wo.status === "complete" ? "status-complete" : wo.status === "cancelled" ? "status-cancelled" : "status-open";

  return (
    <div className="grid" style={{ maxWidth: 940 }}>
      <button className="btn btn-soft" onClick={() => router.back()} style={{ width: "fit-content" }}>
        Back
      </button>

      <div className="section-card grid" style={{ gap: "0.75rem" }}>
        <div className="title-row">
          <h1>
            {wo.wo_number} - {wo.title}
          </h1>
          <span className={`status ${statusClass}`}>{wo.status}</span>
        </div>

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

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <span className="label">Actions</span>
          <button
            className={`btn ${wo.status === "open" ? "btn-active" : "btn-soft"}`}
            onClick={() => updateStatus("open")}
            disabled={wo.status === "open"}
          >
            Mark Open
          </button>
          <button
            className={`btn ${wo.status === "complete" ? "btn-active" : "btn-soft"}`}
            onClick={() => updateStatus("complete")}
            disabled={wo.status === "complete"}
          >
            Mark Complete
          </button>
          <button
            className={`btn ${wo.status === "cancelled" ? "btn-active" : "btn-soft"}`}
            onClick={() => updateStatus("cancelled")}
            disabled={wo.status === "cancelled"}
          >
            Mark Cancelled
          </button>
        </div>

        {wo.status === "cancelled" ? (
          <div className="grid" style={{ gap: "0.55rem" }}>
            <textarea
              className="textarea"
              placeholder="Reason for cancellation..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
            />
            <div>
              <button className="btn btn-soft" onClick={() => saveReason(cancelReason)}>
                Save reason
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="section-card grid" style={{ gap: "0.75rem" }}>
        <h3>Add update</h3>

        <textarea
          className="textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Write a comment..."
          rows={4}
        />

        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <label className="btn btn-soft" style={{ cursor: "pointer" }}>
            Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length) setFiles((prev) => [...prev, ...picked]);
                e.currentTarget.value = "";
              }}
            />
          </label>

          <label className="btn btn-soft" style={{ cursor: "pointer" }}>
            Add photos
            <input
              type="file"
              multiple
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length) setFiles((prev) => [...prev, ...picked]);
                e.currentTarget.value = "";
              }}
            />
          </label>

          <span className="muted">Selected: {files.length}</span>
        </div>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={addUpdate} disabled={saving || (!comment.trim() && files.length === 0)}>
            {saving ? "Saving..." : "Add update"}
          </button>
          {msg ? <span className="muted">{msg}</span> : null}
        </div>
      </div>

      <div className="grid">
        <h3>Updates</h3>

        {updates.map((u) => (
          <div key={u.id} className="section-card" style={{ padding: "0.85rem" }}>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {new Date(u.created_at).toLocaleString()}
            </div>

            {u.comment ? <div style={{ marginTop: "0.45rem" }}>{u.comment}</div> : null}

            {u.photo_urls?.length ? (
              <div className="photo-grid" style={{ marginTop: "0.65rem" }}>
                {u.photo_urls.map((path) => (
                  <a key={path} href={signedMap[path] || "#"} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={signedMap[path] || ""} alt="WO photo" className="photo-thumb" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {updates.length === 0 ? <p className="muted">No updates yet. Add the first one above.</p> : null}
      </div>
    </div>
  );
}
