import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { AppRole } from "@/lib/roles";
import { hasManagerAccess } from "@/lib/roles";

type ProfileRow = {
  tenant_id: string | null;
  role: AppRole;
};

type WorkOrderRow = {
  id: string;
  report_id: string;
};

type ReportRow = {
  id: string;
  tenant_id: string | null;
};

type UpdateRow = {
  photo_urls: string[] | null;
};

export async function POST(req: NextRequest) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

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
    .select("tenant_id, role")
    .eq("id", user.id)
    .single<ProfileRow>();

  if (profileErr || !profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  }
  if (!hasManagerAccess(profile.role)) {
    return NextResponse.json({ error: "Only managers can delete work orders." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const workOrderId = typeof body?.workOrderId === "string" ? body.workOrderId.trim() : "";
  if (!workOrderId) {
    return NextResponse.json({ error: "Missing workOrderId." }, { status: 400 });
  }

  const { data: workOrder, error: woErr } = await adminClient
    .from("work_orders")
    .select("id, report_id")
    .eq("id", workOrderId)
    .maybeSingle<WorkOrderRow>();
  if (woErr) return NextResponse.json({ error: woErr.message }, { status: 500 });
  if (!workOrder) return NextResponse.json({ error: "Work order not found." }, { status: 404 });

  const { data: report, error: reportErr } = await adminClient
    .from("reports")
    .select("id, tenant_id")
    .eq("id", workOrder.report_id)
    .maybeSingle<ReportRow>();
  if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!report || report.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  const { data: updates, error: updatesErr } = await adminClient
    .from("wo_updates")
    .select("photo_urls")
    .eq("work_order_id", workOrderId)
    .returns<UpdateRow[]>();
  if (updatesErr) return NextResponse.json({ error: updatesErr.message }, { status: 500 });

  const photoPaths = [...new Set((updates ?? []).flatMap((update) => update.photo_urls ?? []))];
  if (photoPaths.length) {
    const { error: storageErr } = await adminClient.storage.from("report-photos").remove(photoPaths);
    if (storageErr) return NextResponse.json({ error: storageErr.message }, { status: 500 });
  }

  const { error: updatesDeleteErr } = await adminClient
    .from("wo_updates")
    .delete()
    .eq("work_order_id", workOrderId);
  if (updatesDeleteErr) return NextResponse.json({ error: updatesDeleteErr.message }, { status: 500 });

  const { error: workOrderDeleteErr } = await adminClient
    .from("work_orders")
    .delete()
    .eq("id", workOrderId)
    .eq("report_id", workOrder.report_id);
  if (workOrderDeleteErr) return NextResponse.json({ error: workOrderDeleteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
