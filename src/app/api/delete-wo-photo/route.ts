import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { AppRole } from "@/lib/roles";

type ProfileRow = {
  tenant_id: string | null;
  role: AppRole;
};

type WoUpdateRow = {
  id: string;
  work_order_id: string;
  photo_urls: string[] | null;
};

type WorkOrderRow = {
  id: string;
  report_id: string;
};

type ReportRow = {
  id: string;
  tenant_id: string | null;
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

  const body = await req.json().catch(() => null);
  const updateId = typeof body?.updateId === "string" ? body.updateId : "";
  const photoPath = typeof body?.photoPath === "string" ? body.photoPath : "";

  if (!updateId || !photoPath) {
    return NextResponse.json({ error: "Missing updateId or photoPath." }, { status: 400 });
  }

  const { data: existingUpdate, error: updErr } = await adminClient
    .from("wo_updates")
    .select("id, work_order_id, photo_urls")
    .eq("id", updateId)
    .maybeSingle<WoUpdateRow>();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!existingUpdate) return NextResponse.json({ error: "Work order update not found." }, { status: 404 });

  const currentPhotos = existingUpdate.photo_urls ?? [];
  if (!currentPhotos.includes(photoPath)) {
    return NextResponse.json({ error: "Photo not found on this work order update." }, { status: 404 });
  }

  const { data: wo, error: woErr } = await adminClient
    .from("work_orders")
    .select("id, report_id")
    .eq("id", existingUpdate.work_order_id)
    .maybeSingle<WorkOrderRow>();
  if (woErr) return NextResponse.json({ error: woErr.message }, { status: 500 });
  if (!wo) return NextResponse.json({ error: "Work order not found." }, { status: 404 });

  const { data: report, error: reportErr } = await adminClient
    .from("reports")
    .select("id, tenant_id")
    .eq("id", wo.report_id)
    .maybeSingle<ReportRow>();
  if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!report || report.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: "Work order update not found." }, { status: 404 });
  }

  const nextPhotos = currentPhotos.filter((path) => path !== photoPath);
  const { error: updateErr } = await adminClient
    .from("wo_updates")
    .update({ photo_urls: nextPhotos })
    .eq("id", updateId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { error: storageErr } = await adminClient.storage.from("report-photos").remove([photoPath]);
  if (storageErr) {
    await adminClient.from("wo_updates").update({ photo_urls: currentPhotos }).eq("id", updateId);
    return NextResponse.json({ error: storageErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
