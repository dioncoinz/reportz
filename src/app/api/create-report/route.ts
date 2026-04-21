import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

type ReportPayload = {
  clientName?: string;
  siteName?: string;
  shutdownName?: string;
  startDate?: string;
  endDate?: string;
  vendorKeyContacts?: string;
  clientKeyContacts?: string;
};

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

  const body = (await req.json().catch(() => null)) as ReportPayload | null;
  const clientName = body?.clientName?.trim() ?? "";
  const siteName = body?.siteName?.trim() ?? "";
  const shutdownName = body?.shutdownName?.trim() ?? "";
  const startDate = body?.startDate?.trim() ?? "";
  const endDate = body?.endDate?.trim() ?? "";
  const vendorKeyContacts = body?.vendorKeyContacts?.trim() ?? "";
  const clientKeyContacts = body?.clientKeyContacts?.trim() ?? "";

  if (!shutdownName) {
    return NextResponse.json({ error: "Shutdown name is required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle<{ tenant_id: string | null }>();

  if (profileErr || !profile?.tenant_id) {
    return NextResponse.json({ error: "Profile tenant_id not set." }, { status: 403 });
  }

  const baseReport = {
    tenant_id: profile.tenant_id,
    name: [[clientName, siteName].filter(Boolean).join(" - "), shutdownName].filter(Boolean).join(" "),
    start_date: startDate || null,
    end_date: endDate || null,
    created_by: user.id,
    status: "draft",
  };

  const optionalFields = {
    client_name: clientName || null,
    site_name: siteName || null,
    shutdown_name: shutdownName || null,
    vendor_key_contacts: vendorKeyContacts || null,
    client_key_contacts: clientKeyContacts || null,
    key_personnel: [vendorKeyContacts, clientKeyContacts].filter(Boolean).join("\n") || null,
  };
  let insertPayload: Record<string, string | null> = optionalFields;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await adminClient
      .from("reports")
      .insert({
        ...baseReport,
        ...insertPayload,
      })
      .select("id")
      .single<{ id: string }>();

    if (!error && data?.id) {
      return NextResponse.json({ id: data.id });
    }

    if (!error) {
      return NextResponse.json({ error: "Report was created, but Supabase did not return its id." }, { status: 500 });
    }

    const nextPayload = { ...insertPayload };
    if (isMissingColumn(error, "client_name")) delete nextPayload.client_name;
    if (isMissingColumn(error, "site_name")) delete nextPayload.site_name;
    if (isMissingColumn(error, "shutdown_name")) delete nextPayload.shutdown_name;
    if (isMissingColumn(error, "vendor_key_contacts")) delete nextPayload.vendor_key_contacts;
    if (isMissingColumn(error, "client_key_contacts")) delete nextPayload.client_key_contacts;
    if (isMissingColumn(error, "key_personnel")) delete nextPayload.key_personnel;

    if (Object.keys(nextPayload).length === Object.keys(insertPayload).length) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    insertPayload = nextPayload;
  }

  return NextResponse.json({ error: "Failed to create report." }, { status: 500 });
}
