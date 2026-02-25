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

const ISSUE_PREFIX = "__ISSUE__:";
const NEXT_SHUT_PREFIX = "__NEXT_SHUT__:";

function getEntryKind(comment: string | null): "issue" | "update" {
  if (!comment) return "update";
  if (comment.startsWith(ISSUE_PREFIX)) return "issue";
  return "update";
}

function stripEntryPrefix(comment: string | null): string | null {
  if (!comment) return null;
  if (comment.startsWith(ISSUE_PREFIX)) return comment.slice(ISSUE_PREFIX.length).trim() || null;
  if (comment.startsWith(NEXT_SHUT_PREFIX)) return comment.slice(NEXT_SHUT_PREFIX.length).trim() || null;
  return comment;
}

export default function WorkOrderDetailPage() {
  const supabase = createSupabaseBrowser();
  const router = useRouter();
  const { reportId, woId } = useParams<{ reportId: string; woId: string }>();

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);


  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingIssues, setSavingIssues] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [signedMap, setSignedMap] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [issuesComment, setIssuesComment] = useState("");
  const [issuesFiles, setIssuesFiles] = useState<File[]>([]);
  const maxPhotosPerWo = 6;

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

  async function updateStatus(status: WorkOrder["status"]) {
    if (!wo) return;

    if (status === "cancelled") {
      setShowCancelPrompt(true);
      setErr(null);
      return;
    }

    setShowCancelPrompt(false);
    const { error } = await supabase
      .from("work_orders")
      .update({
        status,
        completed_at: status === "complete" ? new Date().toISOString() : null,
        cancelled_reason: null,
      })
      .eq("id", wo.id);

    if (error) {
      setErr(error.message);
      return;
    }

    await load();
  }

  async function confirmCancelStatus() {
    if (!wo) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setErr("Please enter a cancellation reason.");
      return;
    }

    const { error } = await supabase
      .from("work_orders")
      .update({
        status: "cancelled",
        completed_at: null,
        cancelled_reason: reason,
      })
      .eq("id", wo.id);

    if (error) {
      setErr(error.message);
      return;
    }

    setShowCancelPrompt(false);
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

  async function addEntry(kind: "update" | "issue") {
    const isUpdate = kind === "update";
    const isIssue = kind === "issue";

    if (isUpdate) setSaving(true);
    if (isIssue) setSavingIssues(true);

    setMsg(null);
    setErr(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const user = userRes.user;

    if (userErr || !user) {
      if (isUpdate) setSaving(false);
      if (isIssue) setSavingIssues(false);
      setErr("You are not signed in.");
      return;
    }

    const chosenFiles = isUpdate ? files : issuesFiles;
    const rawComment = isUpdate ? comment : issuesComment;
    const photoPaths: string[] = [];
    const existingPhotoCount = updates.reduce((n, u) => n + (u.photo_urls?.length ?? 0), 0);

    if (existingPhotoCount + chosenFiles.length > maxPhotosPerWo) {
      if (isUpdate) setSaving(false);
      if (isIssue) setSavingIssues(false);
      setErr(`Photo limit reached. Max ${maxPhotosPerWo} photos per work order.`);
      return;
    }

    for (const file of chosenFiles) {
      const safeName = file.name.replace(/\s+/g, "_");
      const path = `${reportId}/${woId}/${kind}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage.from("report-photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (upErr) {
        if (isUpdate) setSaving(false);
        if (isIssue) setSavingIssues(false);
        setErr(`Photo upload failed: ${upErr.message}`);
        return;
      }

      photoPaths.push(path);
    }

    const cleaned = rawComment.trim();
    const taggedComment = isIssue ? `${ISSUE_PREFIX} ${cleaned}`.trim() : cleaned;

    const { error: insErr } = await supabase.from("wo_updates").insert({
      work_order_id: woId,
      created_by: user.id,
      comment: taggedComment || null,
      photo_urls: photoPaths,
    });

    if (insErr) {
      if (isUpdate) setSaving(false);
      if (isIssue) setSavingIssues(false);
      setErr(insErr.message);
      return;
    }

    if (isUpdate) {
      setComment("");
      setFiles([]);
    } else {
      setIssuesComment("");
      setIssuesFiles([]);
    }

    setMsg(isUpdate ? "Update added" : "Issue saved");
    if (isUpdate) setSaving(false);
    if (isIssue) setSavingIssues(false);
    await load();
  }

  const generalUpdates = updates.filter((u) => getEntryKind(u.comment) === "update");
  const issueEntries = updates.filter((u) => getEntryKind(u.comment) === "issue");
  const existingPhotoCount = updates.reduce((n, u) => n + (u.photo_urls?.length ?? 0), 0);
  const remainingPhotoSlots = Math.max(maxPhotosPerWo - existingPhotoCount, 0);

  function addFilesWithLimit(current: File[], picked: File[]) {
    const allowed = Math.max(remainingPhotoSlots - current.length, 0);
    if (allowed <= 0) {
      setErr(`Photo limit reached. Max ${maxPhotosPerWo} photos per work order.`);
      return current;
    }
    const accepted = picked.slice(0, allowed);
    if (picked.length > allowed) {
      setErr(`Only ${maxPhotosPerWo} photos are allowed per work order.`);
    }
    return [...current, ...accepted];
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
            disabled={wo.status === "cancelled" && !showCancelPrompt}
          >
            Mark Cancelled
          </button>
        </div>

        {showCancelPrompt ? (
          <div className="grid" style={{ gap: "0.55rem" }}>
            <textarea
              className="textarea"
              placeholder="Enter cancellation reason..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
            />
            <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
              <button className="btn btn-danger" onClick={confirmCancelStatus}>
                Confirm Cancel
              </button>
              <button className="btn btn-soft" onClick={() => setShowCancelPrompt(false)}>
                Close
              </button>
            </div>
          </div>
        ) : null}

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
        <h3>Comments</h3>

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
                if (picked.length) setFiles((prev) => addFilesWithLimit(prev, picked));
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
                if (picked.length) setFiles((prev) => addFilesWithLimit(prev, picked));
                e.currentTarget.value = "";
              }}
            />
          </label>

          <span className="muted">Selected: {files.length}</span>
          <span className="muted">WO photos remaining: {remainingPhotoSlots}</span>
        </div>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={() => addEntry("update")}
            disabled={saving || (!comment.trim() && files.length === 0)}
          >
            {saving ? "Saving..." : "Save comment"}
          </button>
          {msg ? <span className="muted">{msg}</span> : null}
        </div>
      </div>

      <div className="section-card grid" style={{ gap: "0.75rem" }}>
        <h3>Issues</h3>
        <textarea
          className="textarea"
          value={issuesComment}
          onChange={(e) => setIssuesComment(e.target.value)}
          placeholder="Describe issue found..."
          rows={3}
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
                if (picked.length) setIssuesFiles((prev) => addFilesWithLimit(prev, picked));
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
                if (picked.length) setIssuesFiles((prev) => addFilesWithLimit(prev, picked));
                e.currentTarget.value = "";
              }}
            />
          </label>
          <span className="muted">Selected: {issuesFiles.length}</span>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={() => addEntry("issue")}
            disabled={savingIssues || (!issuesComment.trim() && issuesFiles.length === 0)}
          >
            {savingIssues ? "Saving..." : "Save issue"}
          </button>
        </div>
      </div>

      <div className="grid">
        <h3>Comments</h3>

        {generalUpdates.map((u) => (
          <div key={u.id} className="section-card" style={{ padding: "0.85rem" }}>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {new Date(u.created_at).toLocaleString()}
            </div>

            {u.comment ? <div style={{ marginTop: "0.45rem" }}>{stripEntryPrefix(u.comment)}</div> : null}

            {u.photo_urls?.length ? (
              <div className="photo-grid" style={{ marginTop: "0.65rem" }}>
                {u.photo_urls.map((path) => (
                  signedMap[path] ? (
                    <a key={path} href={signedMap[path]} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={signedMap[path]} alt="WO photo" className="photo-thumb" />
                    </a>
                  ) : (
                    <div
                      key={path}
                      className="photo-thumb"
                      style={{ display: "grid", placeItems: "center", color: "var(--muted)", fontSize: "0.8rem" }}
                    >
                      Loading photo...
                    </div>
                  )
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {generalUpdates.length === 0 ? <p className="muted">No comments yet. Add the first one above.</p> : null}
      </div>

      <div className="grid">
        <h3>Logged Issues</h3>
        {issueEntries.map((u) => (
          <div key={u.id} className="section-card" style={{ padding: "0.85rem" }}>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {new Date(u.created_at).toLocaleString()}
            </div>
            {u.comment ? <div style={{ marginTop: "0.45rem" }}>{stripEntryPrefix(u.comment)}</div> : null}
            {u.photo_urls?.length ? (
              <div className="photo-grid" style={{ marginTop: "0.65rem" }}>
                {u.photo_urls.map((path) => (
                  signedMap[path] ? (
                    <a key={path} href={signedMap[path]} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={signedMap[path]} alt="Issue photo" className="photo-thumb" />
                    </a>
                  ) : (
                    <div
                      key={path}
                      className="photo-thumb"
                      style={{ display: "grid", placeItems: "center", color: "var(--muted)", fontSize: "0.8rem" }}
                    >
                      Loading photo...
                    </div>
                  )
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {issueEntries.length === 0 ? <p className="muted">No issues logged yet.</p> : null}
      </div>

    </div>
  );
}
