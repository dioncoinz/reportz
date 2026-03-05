import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

type WorkOrderRow = {
  id: string;
  wo_number: string;
  title: string | null;
  status: "open" | "complete" | "cancelled";
  emergent_work: boolean;
  cancelled_reason: string | null;
  completed_at: string | null;
  created_at: string;
};
const EMERGENT_PREFIX = "__EMERGENT__:";

function getErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) return maybeMessage;
    try {
      return JSON.stringify(err);
    } catch {
      return "";
    }
  }
  return "";
}

function isMissingColumnError(err: unknown, column: string) {
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

export async function GET(req: NextRequest) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const reportId = req.nextUrl.searchParams.get("reportId");
  if (!reportId) {
    return NextResponse.json({ error: "Missing reportId." }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing authorization header." }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: authErr } = await userClient.auth.getUser();
  const user = userRes.user;
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle<{ tenant_id: string | null }>();
  if (profileErr || !profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  }

  const { data: report, error: reportErr } = await adminClient
    .from("reports")
    .select("id")
    .eq("id", reportId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle<{ id: string }>();

  if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const { data: workOrders, error: woErr } = await adminClient
    .from("work_orders")
    .select("id, wo_number, title, status, emergent_work, cancelled_reason, completed_at, created_at")
    .eq("report_id", reportId)
    .order("wo_number", { ascending: true })
    .returns<WorkOrderRow[]>();

  if (woErr) {
    if (!isMissingColumnError(woErr, "emergent_work")) {
      return NextResponse.json({ error: woErr.message }, { status: 500 });
    }

    const fallback = await adminClient
      .from("work_orders")
      .select("id, wo_number, title, status, cancelled_reason, completed_at, created_at")
      .eq("report_id", reportId)
      .order("wo_number", { ascending: true })
      .returns<Array<Omit<WorkOrderRow, "emergent_work">>>();

    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });

    const mapped = (fallback.data ?? []).map((w) => ({ ...w, emergent_work: false }));
    const woIds = mapped.map((w) => w.id);
    if (!woIds.length) return NextResponse.json({ workOrders: mapped });
    const markerRes = await adminClient
      .from("wo_updates")
      .select("work_order_id, comment")
      .in("work_order_id", woIds);
    if (markerRes.error) return NextResponse.json({ error: markerRes.error.message }, { status: 500 });
    const emergentIds = new Set(
      (markerRes.data ?? [])
        .filter((u) => typeof u.comment === "string" && u.comment.startsWith(EMERGENT_PREFIX))
        .map((u) => String(u.work_order_id))
    );
    return NextResponse.json({
      workOrders: mapped.map((w) => ({ ...w, emergent_work: w.emergent_work || emergentIds.has(w.id) })),
    });
  }

  const rows = workOrders ?? [];
  const woIds = rows.map((w) => w.id);
  if (!woIds.length) return NextResponse.json({ workOrders: rows });
  const markerRes = await adminClient
    .from("wo_updates")
    .select("work_order_id, comment")
    .in("work_order_id", woIds);
  if (markerRes.error) return NextResponse.json({ error: markerRes.error.message }, { status: 500 });
  const emergentIds = new Set(
    (markerRes.data ?? [])
      .filter((u) => typeof u.comment === "string" && u.comment.startsWith(EMERGENT_PREFIX))
      .map((u) => String(u.work_order_id))
  );
  return NextResponse.json({
    workOrders: rows.map((w) => ({ ...w, emergent_work: w.emergent_work || emergentIds.has(w.id) })),
  });
}
