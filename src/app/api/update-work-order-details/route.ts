import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

type Role = "contributor" | "supervisor" | "manager";

type WorkOrderDetailsPayload = {
  workOrderId?: string;
  woNumber?: string;
  title?: string;
};

export async function POST(req: NextRequest) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ error: "Missing authorization header." }, { status: 401 });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: authErr } = await userClient.auth.getUser();
  const user = userRes.user;
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as WorkOrderDetailsPayload | null;
  const workOrderId = body?.workOrderId?.trim() ?? "";
  const woNumber = body?.woNumber?.trim() ?? "";
  const title = body?.title?.trim() ?? "";

  if (!workOrderId) return NextResponse.json({ error: "Missing workOrderId." }, { status: 400 });
  if (!woNumber) return NextResponse.json({ error: "WO number is required." }, { status: 400 });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle<{ tenant_id: string | null; role: Role }>();

  if (profileErr || !profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  }
  if (profile.role !== "manager") {
    return NextResponse.json({ error: "Only managers can edit work order details." }, { status: 403 });
  }

  const { data: workOrder, error: workOrderErr } = await adminClient
    .from("work_orders")
    .select("id, report_id")
    .eq("id", workOrderId)
    .maybeSingle<{ id: string; report_id: string }>();
  if (workOrderErr) return NextResponse.json({ error: workOrderErr.message }, { status: 500 });
  if (!workOrder) return NextResponse.json({ error: "Work order not found." }, { status: 404 });

  const { data: report, error: reportErr } = await adminClient
    .from("reports")
    .select("id")
    .eq("id", workOrder.report_id)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle<{ id: string }>();
  if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!report) return NextResponse.json({ error: "Work order not found." }, { status: 404 });

  const { error: updateErr } = await adminClient
    .from("work_orders")
    .update({
      wo_number: woNumber,
      title: title || null,
    })
    .eq("id", workOrderId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
