import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

type ReportDetailsPayload = {
  reportId?: string;
  clientName?: string;
  siteName?: string;
  shutdownName?: string;
  startDate?: string;
  endDate?: string;
  vendorKeyContacts?: string;
  clientKeyContacts?: string;
};

type Role = "contributor" | "supervisor" | "manager";

function isMissingColumn(error: { message?: string; code?: string } | null, column: string) {
  return Boolean(error?.message?.includes(column) || error?.code === "PGRST204");
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

  const body = (await req.json().catch(() => null)) as ReportDetailsPayload | null;
  const reportId = body?.reportId?.trim() ?? "";
  const clientName = body?.clientName?.trim() ?? "";
  const siteName = body?.siteName?.trim() ?? "";
  const shutdownName = body?.shutdownName?.trim() ?? "";
  const startDate = body?.startDate?.trim() ?? "";
  const endDate = body?.endDate?.trim() ?? "";
  const vendorKeyContacts = body?.vendorKeyContacts?.trim() ?? "";
  const clientKeyContacts = body?.clientKeyContacts?.trim() ?? "";

  if (!reportId) return NextResponse.json({ error: "Missing reportId." }, { status: 400 });
  if (!shutdownName) return NextResponse.json({ error: "Shutdown name is required." }, { status: 400 });

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
    return NextResponse.json({ error: "Only managers can edit report details." }, { status: 403 });
  }

  const { data: report, error: reportErr } = await adminClient
    .from("reports")
    .select("id")
    .eq("id", reportId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle<{ id: string }>();
  if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const baseUpdate = {
    name: [[clientName, siteName].filter(Boolean).join(" - "), shutdownName].filter(Boolean).join(" "),
    start_date: startDate || null,
    end_date: endDate || null,
  };
  const optionalFields = {
    client_name: clientName || null,
    site_name: siteName || null,
    shutdown_name: shutdownName || null,
    vendor_key_contacts: vendorKeyContacts || null,
    client_key_contacts: clientKeyContacts || null,
    key_personnel: [vendorKeyContacts, clientKeyContacts].filter(Boolean).join("\n") || null,
  };
  let updatePayload: Record<string, string | null> = optionalFields;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await adminClient
      .from("reports")
      .update({
        ...baseUpdate,
        ...updatePayload,
      })
      .eq("id", reportId)
      .eq("tenant_id", profile.tenant_id);

    if (!error) {
      return NextResponse.json({ ok: true });
    }

    const nextPayload = { ...updatePayload };
    if (isMissingColumn(error, "client_name")) delete nextPayload.client_name;
    if (isMissingColumn(error, "site_name")) delete nextPayload.site_name;
    if (isMissingColumn(error, "shutdown_name")) delete nextPayload.shutdown_name;
    if (isMissingColumn(error, "vendor_key_contacts")) delete nextPayload.vendor_key_contacts;
    if (isMissingColumn(error, "client_key_contacts")) delete nextPayload.client_key_contacts;
    if (isMissingColumn(error, "key_personnel")) delete nextPayload.key_personnel;

    if (Object.keys(nextPayload).length === Object.keys(updatePayload).length) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updatePayload = nextPayload;
  }

  return NextResponse.json({ error: "Failed to update report details." }, { status: 500 });
}
