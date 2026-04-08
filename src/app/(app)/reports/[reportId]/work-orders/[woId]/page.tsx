"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hasManagerAccess } from "@/lib/roles";

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
const EMERGENT_PREFIX = "__EMERGENT__:";

function getEntryKind(comment: string | null): "issue" | "update" {
  if (!comment) return "update";
  if (comment.startsWith(EMERGENT_PREFIX)) return "issue";
  if (comment.startsWith(ISSUE_PREFIX)) return "issue";
  return "update";
}

function stripEntryPrefix(comment: string | null): string | null {
  if (!comment) return null;
  if (comment.startsWith(EMERGENT_PREFIX)) return null;
  if (comment.startsWith(ISSUE_PREFIX)) return comment.slice(ISSUE_PREFIX.length).trim() || null;
  if (comment.startsWith(NEXT_SHUT_PREFIX)) return comment.slice(NEXT_SHUT_PREFIX.length).trim() || null;
  return comment;
}

function splitBulletLines(text: string | null) {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[\-\*\u2022]\s*/, "").trim())
    .filter(Boolean);
}

export default function WorkOrderDetailPage() {
  const supabase = createSupabaseBrowser();
  const { profile } = useProfile();
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
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState("");
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [editingIssueComment, setEditingIssueComment] = useState("");
  const [savingIssueEditId, setSavingIssueEditId] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const issuesRef = useRef<HTMLTextAreaElement | null>(null);
  const [deletingPhotoKey, setDeletingPhotoKey] = useState<string | null>(null);
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

  async function saveExistingCompletionComment(updateId: string) {
    if (!hasManagerAccess(profile?.role)) {
      setErr("Only managers and owners can edit saved completion comments.");
      return;
    }

    const cleaned = editingComment.trim();
    if (!cleaned) {
      setErr("Comment cannot be empty.");
      return;
    }

    setErr(null);
    setMsg(null);
    setSavingEditId(updateId);

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (sessionErr || !token) {
      setSavingEditId(null);
      setErr("You must be signed in to edit comments.");
      return;
    }

    const res = await fetch("/api/edit-wo-update-comment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ updateId, comment: cleaned, entryKind: "completion" }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSavingEditId(null);
      setErr(typeof json?.error === "string" ? json.error : "Failed to update comment.");
      return;
    }

    setSavingEditId(null);
    setEditingUpdateId(null);
    setEditingComment("");
    setMsg("Completion comment updated");
    await load();
  }

  async function saveExistingIssueComment(updateId: string) {
    if (!hasManagerAccess(profile?.role)) {
      setErr("Only managers and owners can edit saved issues/recommendations.");
      return;
    }

    const cleaned = editingIssueComment.trim();
    if (!cleaned) {
      setErr("Issue/recommendation cannot be empty.");
      return;
    }

    setErr(null);
    setMsg(null);
    setSavingIssueEditId(updateId);

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (sessionErr || !token) {
      setSavingIssueEditId(null);
      setErr("You must be signed in to edit issues/recommendations.");
      return;
    }

    const res = await fetch("/api/edit-wo-update-comment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ updateId, comment: cleaned, entryKind: "issue" }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSavingIssueEditId(null);
      setErr(typeof json?.error === "string" ? json.error : "Failed to update issue/recommendation.");
      return;
    }

    setSavingIssueEditId(null);
    setEditingIssueId(null);
    setEditingIssueComment("");
    setMsg("Issue/recommendation updated");
    await load();
  }

  async function deletePhoto(updateId: string, photoPath: string) {
    const confirmed = window.confirm("Delete this photo from the work order?");
    if (!confirmed) return;

    setErr(null);
    setMsg(null);
    setDeletingPhotoKey(`${updateId}:${photoPath}`);

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (sessionErr || !token) {
      setDeletingPhotoKey(null);
      setErr("You must be signed in to delete photos.");
      return;
    }

    const res = await fetch("/api/delete-wo-photo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ updateId, photoPath }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDeletingPhotoKey(null);
      setErr(typeof json?.error === "string" ? json.error : "Failed to delete photo.");
      return;
    }

    setSignedMap((prev) => {
      const next = { ...prev };
      delete next[photoPath];
      return next;
    });
    setDeletingPhotoKey(null);
    setMsg("Photo deleted");
    await load();
  }

  const generalUpdates = updates.filter((u) => getEntryKind(u.comment) === "update");
  const issueEntries = updates.filter(
    (u) => getEntryKind(u.comment) === "issue" && !(u.comment?.startsWith(EMERGENT_PREFIX))
  );
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

  function insertBullet(
    ref: React.RefObject<HTMLTextAreaElement | null>,
    currentValue: string,
    setValue: (next: string) => void
  ) {
    const el = ref.current;
    if (!el) {
      setValue(`${currentValue}${currentValue.endsWith("\n") || currentValue.length === 0 ? "" : "\n"}• `);
      return;
    }

    const start = el.selectionStart ?? currentValue.length;
    const end = el.selectionEnd ?? currentValue.length;
    const before = currentValue.slice(0, start);
    const after = currentValue.slice(end);
    const needsBreak = before.length > 0 && !before.endsWith("\n");
    const insert = `${needsBreak ? "\n" : ""}• `;
    const next = `${before}${insert}${after}`;
    setValue(next);

    queueMicrotask(() => {
      const cursor = before.length + insert.length;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function handleBulletEnter(
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    ref: React.RefObject<HTMLTextAreaElement | null>,
    currentValue: string,
    setValue: (next: string) => void
  ) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const el = ref.current;
    if (!el) {
      setValue(`${currentValue}\n• `.replace(/^\n/, "• "));
      return;
    }

    const start = el.selectionStart ?? currentValue.length;
    const end = el.selectionEnd ?? currentValue.length;
    const lineStart = currentValue.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
    const lineEndIdx = currentValue.indexOf("\n", start);
    const lineEnd = lineEndIdx === -1 ? currentValue.length : lineEndIdx;
    const currentLine = currentValue.slice(lineStart, lineEnd).trim();
    if (currentLine === "•" || currentLine === "-") {
      return;
    }
    const before = currentValue.slice(0, start);
    const after = currentValue.slice(end);
    const separator = before.length === 0 ? "" : "\n";
    const next = `${before}${separator}• ${after}`;
    setValue(next);

    queueMicrotask(() => {
      const cursor = before.length + separator.length + 2;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function ensureLeadingBullet(value: string, setValue: (next: string) => void) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (/^[\-\*\u2022]\s+/.test(value)) return;
    setValue(`• ${value}`);
  }
  function renderPhotoThumb(path: string, alt: string, updateId: string) {
    const isDeleting = deletingPhotoKey === `${updateId}:${path}`;

    return (
      <div key={path} className="photo-card">
        <button
          type="button"
          className="photo-delete-btn"
          aria-label="Delete photo"
          title="Delete photo"
          disabled={isDeleting}
          onClick={() => void deletePhoto(updateId, path)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 10h2v7H7v-7Zm1 11c-1.1 0-2-.9-2-2V8h12v11c0 1.1-.9 2-2 2H8Z"
              fill="currentColor"
            />
          </svg>
        </button>

        {signedMap[path] ? (
          <a href={signedMap[path]} target="_blank" rel="noreferrer" className="photo-link">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signedMap[path]} alt={alt} className="photo-thumb" />
          </a>
        ) : (
          <div
            className="photo-thumb"
            style={{ display: "grid", placeItems: "center", color: "var(--muted)", fontSize: "0.8rem" }}
          >
            Loading photo...
          </div>
        )}
      </div>
    );
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
        <h3>Completion Comments</h3>

        <textarea
          className="textarea"
          ref={commentRef}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onFocus={() => {
            if (!comment.trim()) setComment("• ");
          }}
          onBlur={() => ensureLeadingBullet(comment, setComment)}
          onKeyDown={(e) => handleBulletEnter(e, commentRef, comment, setComment)}
          placeholder="Write completion comments..."
          rows={4}
          wrap="off"
          style={{ paddingLeft: "0.8rem", overflowX: "auto" }}
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
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => insertBullet(commentRef, comment, setComment)}
          >
            Add bullet
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={() => addEntry("update")}
            disabled={saving || (!comment.trim() && files.length === 0)}
          >
            {saving ? "Saving..." : "Save completion comment"}
          </button>
          {msg ? <span className="muted">{msg}</span> : null}
        </div>
      </div>

      <div className="section-card grid" style={{ gap: "0.75rem" }}>
        <h3>Issues/Recommendations</h3>
        <textarea
          className="textarea"
          ref={issuesRef}
          value={issuesComment}
          onChange={(e) => setIssuesComment(e.target.value)}
          onFocus={() => {
            if (!issuesComment.trim()) setIssuesComment("• ");
          }}
          onBlur={() => ensureLeadingBullet(issuesComment, setIssuesComment)}
          onKeyDown={(e) => handleBulletEnter(e, issuesRef, issuesComment, setIssuesComment)}
          placeholder="Describe issue or recommendation..."
          rows={3}
          wrap="off"
          style={{ paddingLeft: "0.8rem", overflowX: "auto" }}
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
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => insertBullet(issuesRef, issuesComment, setIssuesComment)}
          >
            Add bullet
          </button>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={() => addEntry("issue")}
            disabled={savingIssues || (!issuesComment.trim() && issuesFiles.length === 0)}
          >
            {savingIssues ? "Saving..." : "Save issue/recommendation"}
          </button>
        </div>
      </div>

      <div className="grid">
        <h3>Completion Comments</h3>

        {generalUpdates.map((u) => (
          <div key={u.id} className="section-card" style={{ padding: "0.85rem" }}>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {new Date(u.created_at).toLocaleString()}
            </div>

            {editingUpdateId === u.id ? (
              <div className="grid" style={{ marginTop: "0.5rem", gap: "0.55rem" }}>
                <textarea
                  className="textarea"
                  value={editingComment}
                  onChange={(e) => setEditingComment(e.target.value)}
                  rows={4}
                  placeholder="Edit saved completion comment..."
                />
                <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => saveExistingCompletionComment(u.id)}
                    disabled={savingEditId === u.id || !editingComment.trim()}
                  >
                    {savingEditId === u.id ? "Saving..." : "Save edit"}
                  </button>
                  <button
                    className="btn btn-soft"
                    onClick={() => {
                      setEditingUpdateId(null);
                      setEditingComment("");
                    }}
                    disabled={savingEditId === u.id}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {u.comment ? (
                  <ul style={{ marginTop: "0.45rem", marginBottom: 0, paddingLeft: "1.2rem" }}>
                    {splitBulletLines(stripEntryPrefix(u.comment)).map((line, idx) => (
                      <li key={`${u.id}-comment-${idx}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                {hasManagerAccess(profile?.role) && u.comment ? (
                  <div style={{ marginTop: "0.6rem" }}>
                    <button
                      className="btn btn-soft"
                      onClick={() => {
                        setEditingUpdateId(u.id);
                        setEditingComment(stripEntryPrefix(u.comment) ?? "");
                        setErr(null);
                        setMsg(null);
                      }}
                    >
                      Edit saved comment
                    </button>
                  </div>
                ) : null}
              </>
            )}

            {u.photo_urls?.length ? (
              <div className="photo-grid" style={{ marginTop: "0.65rem" }}>
                {u.photo_urls.map((path) => renderPhotoThumb(path, "WO photo", u.id))}
              </div>
            ) : null}
          </div>
        ))}

        {generalUpdates.length === 0 ? <p className="muted">No completion comments yet. Add the first one above.</p> : null}
      </div>

      <div className="grid">
        <h3>Logged Issues/Recommendations</h3>
        {issueEntries.map((u) => (
          <div key={u.id} className="section-card" style={{ padding: "0.85rem" }}>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {new Date(u.created_at).toLocaleString()}
            </div>
            {editingIssueId === u.id ? (
              <div className="grid" style={{ marginTop: "0.5rem", gap: "0.55rem" }}>
                <textarea
                  className="textarea"
                  value={editingIssueComment}
                  onChange={(e) => setEditingIssueComment(e.target.value)}
                  rows={3}
                  placeholder="Edit saved issue/recommendation..."
                />
                <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => saveExistingIssueComment(u.id)}
                    disabled={savingIssueEditId === u.id || !editingIssueComment.trim()}
                  >
                    {savingIssueEditId === u.id ? "Saving..." : "Save edit"}
                  </button>
                  <button
                    className="btn btn-soft"
                    onClick={() => {
                      setEditingIssueId(null);
                      setEditingIssueComment("");
                    }}
                    disabled={savingIssueEditId === u.id}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {u.comment ? (
                  <ul style={{ marginTop: "0.45rem", marginBottom: 0, paddingLeft: "1.2rem" }}>
                    {splitBulletLines(stripEntryPrefix(u.comment)).map((line, idx) => (
                      <li key={`${u.id}-issue-${idx}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                {hasManagerAccess(profile?.role) && u.comment ? (
                  <div style={{ marginTop: "0.6rem" }}>
                    <button
                      className="btn btn-soft"
                      onClick={() => {
                        setEditingIssueId(u.id);
                        setEditingIssueComment(stripEntryPrefix(u.comment) ?? "");
                        setErr(null);
                        setMsg(null);
                      }}
                    >
                      Edit saved issue/recommendation
                    </button>
                  </div>
                ) : null}
              </>
            )}
            {u.photo_urls?.length ? (
              <div className="photo-grid" style={{ marginTop: "0.65rem" }}>
                {u.photo_urls.map((path) => renderPhotoThumb(path, "Issue photo", u.id))}
              </div>
            ) : null}
          </div>
        ))}
        {issueEntries.length === 0 ? <p className="muted">No issues/recommendations logged yet.</p> : null}
      </div>

    </div>
  );
}
