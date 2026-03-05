import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

const EMERGENT_PREFIX = "__EMERGENT__:";

function getErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) return maybeMessage;
  }
  return "Unknown error";
}

function isMissingColumnError(err: unknown, column: string) {
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

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

  const body = await req.json().catch(() => null);
  const reportId = (body?.reportId as string | undefined)?.trim();
  const woNumber = (body?.woNumber as string | undefined)?.trim();
  const title = (body?.title as string | undefined)?.trim() ?? "";

  if (!reportId || !woNumber) {
    return NextResponse.json({ error: "reportId and woNumber are required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle<{ tenant_id: string | null }>();
  if (profileErr || !profile?.tenant_id) return NextResponse.json({ error: "Profile not found." }, { status: 403 });

  const { data: report, error: reportErr } = await adminClient
    .from("reports")
    .select("id")
    .eq("id", reportId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle<{ id: string }>();
  if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const { data: exists, error: existsErr } = await adminClient
    .from("work_orders")
    .select("id")
    .eq("report_id", reportId)
    .eq("wo_number", woNumber)
    .maybeSingle<{ id: string }>();
  if (existsErr && !getErrorMessage(existsErr).toLowerCase().includes("no rows")) {
    return NextResponse.json({ error: existsErr.message }, { status: 500 });
  }
  if (exists) {
    return NextResponse.json({ error: "WO number already exists in this report." }, { status: 409 });
  }

  const basePayload: Record<string, unknown> = {
    report_id: reportId,
    wo_number: woNumber,
    title: title || "Emergent work",
    status: "open",
  };

  let supportsEmergent = true;
  let supportsTenantId = true;
  {
    const probeEmergent = await adminClient.from("work_orders").select("emergent_work").limit(1);
    if (probeEmergent.error) {
      if (isMissingColumnError(probeEmergent.error, "emergent_work")) supportsEmergent = false;
      else return NextResponse.json({ error: probeEmergent.error.message }, { status: 500 });
    }
    const probeTenant = await adminClient.from("work_orders").select("tenant_id").limit(1);
    if (probeTenant.error) {
      if (isMissingColumnError(probeTenant.error, "tenant_id")) supportsTenantId = false;
      else return NextResponse.json({ error: probeTenant.error.message }, { status: 500 });
    }
  }

  if (supportsEmergent) basePayload.emergent_work = true;
  if (supportsTenantId) basePayload.tenant_id = profile.tenant_id;

  const { data: inserted, error: insertErr } = await adminClient
    .from("work_orders")
    .insert(basePayload)
    .select("id")
    .single<{ id: string }>();
  if (insertErr || !inserted?.id) return NextResponse.json({ error: insertErr?.message ?? "Insert failed" }, { status: 500 });

  const { error: markerErr } = await adminClient.from("wo_updates").insert({
    work_order_id: inserted.id,
    created_by: user.id,
    comment: `${EMERGENT_PREFIX} Added via emergent flow`,
    photo_urls: [],
  });
  if (markerErr) return NextResponse.json({ error: markerErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
