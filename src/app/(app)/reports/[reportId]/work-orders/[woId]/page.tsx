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

  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [signedMap, setSignedMap] = useState<Record<string, string>>({});

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
    setUpdates((updData ?? []) as UpdateRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (woId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  // Gather unique photo paths
  const allPhotoPaths = useMemo(() => {
    const paths: string[] = [];
    for (const u of updates) for (const p of u.photo_urls ?? []) paths.push(p);
    return Array.from(new Set(paths));
  }, [updates]);

  // Create signed URLs for private bucket display
  useEffect(() => {
    async function signMissing() {
      const missing = allPhotoPaths.filter((p) => !signedMap[p]);
      if (missing.length === 0) return;

      const next: Record<string, string> = { ...signedMap };

      for (const path of missing) {
        const { data, error } = await supabase.storage
          .from("report-photos")
          .createSignedUrl(path, 60 * 60);

        if (!error && data?.signedUrl) next[path] = data.signedUrl;
      }

      setSignedMap(next);
    }

    signMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPhotoPaths]);

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

    // Upload photos
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

    // Insert update
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
    setMsg("✅ Update added");
    setSaving(false);
    await load();
  }

  if (loading) return <p>Loading…</p>;

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: "tomato" }}>{err}</p>
        <button onClick={() => router.back()}>Back</button>
      </div>
    );
  }

  if (!wo) return <p>Not found.</p>;

  return (
    <div style={{ maxWidth: 900 }}>
      <button onClick={() => router.back()} style={{ marginBottom: 12 }}>
        ← Back
      </button>

      <h1 style={{ margin: 0 }}>
        {wo.wo_number} — {wo.title}
      </h1>
      <div style={{ opacity: 0.8, fontSize: 12, marginTop: 6 }}>
        Status: {wo.status}
        {wo.status === "cancelled" && wo.cancelled_reason ? ` • Reason: ${wo.cancelled_reason}` : ""}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #333", borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>Add update</h3>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Write a comment..."
          rows={4}
          style={{ width: "100%", padding: 10, resize: "vertical" }}
        />

        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
  {/* Take photo (camera) */}
  <label
    style={{
      display: "inline-block",
      padding: "10px 12px",
      border: "1px solid #333",
      borderRadius: 10,
      cursor: "pointer",
      fontWeight: 700,
    }}
  >
    📷 Take photo
    <input
      type="file"
      accept="image/*"
      capture="environment"
      style={{ display: "none" }}
      onChange={(e) => {
        const picked = Array.from(e.target.files ?? []);
        if (picked.length) setFiles((prev) => [...prev, ...picked]);
        e.currentTarget.value = ""; // allow taking same photo twice
      }}
    />
  </label>

  {/* Choose from gallery (multiple) */}
  <label
    style={{
      display: "inline-block",
      padding: "10px 12px",
      border: "1px solid #333",
      borderRadius: 10,
      cursor: "pointer",
      fontWeight: 700,
    }}
  >
    🖼️ Add photos
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

  <div style={{ opacity: 0.75, fontSize: 12, alignSelf: "center" }}>
    Selected: {files.length}
  </div>
</div>
          <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
            Tip: take photos on phone, upload here.
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={addUpdate} disabled={saving || (!comment.trim() && files.length === 0)}>
            {saving ? "Saving…" : "Add update"}
          </button>
          {msg ? <span style={{ opacity: 0.9 }}>{msg}</span> : null}
        </div>
      </div>

      <h3 style={{ marginTop: 18 }}>Updates</h3>

      <div style={{ display: "grid", gap: 12 }}>
        {updates.map((u) => (
          <div key={u.id} style={{ border: "1px solid #333", borderRadius: 10, padding: 12 }}>
            <div style={{ opacity: 0.7, fontSize: 12 }}>
              {new Date(u.created_at).toLocaleString()}
            </div>

            {u.comment ? <div style={{ marginTop: 6 }}>{u.comment}</div> : null}

            {u.photo_urls?.length ? (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {u.photo_urls.map((path) => (
                  <a key={path} href={signedMap[path] || "#"} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={signedMap[path] || ""}
                      alt="WO photo"
                      style={{
                        width: 180,
                        height: 120,
                        objectFit: "cover",
                        borderRadius: 8,
                        border: "1px solid #222",
                        background: "#111",
                      }}
                    />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {updates.length === 0 ? <p style={{ opacity: 0.8 }}>No updates yet. Add the first one above.</p> : null}
      </div>
    </div>
  );
}
