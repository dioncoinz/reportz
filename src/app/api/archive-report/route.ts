import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ARCHIVE_PREFIX = "[ARCHIVED] ";

type Role = "contributor" | "supervisor" | "manager";

export async function POST(req: NextRequest) {
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
    .single<{ tenant_id: string | null; role: Role }>();

  if (profileErr || !profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  }

  if (profile.role !== "manager") {
    return NextResponse.json({ error: "Only managers can archive reports." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const reportId = body?.reportId as string | undefined;
  if (!reportId) {
    return NextResponse.json({ error: "Missing reportId." }, { status: 400 });
  }

  const { data: report, error: reportErr } = await adminClient
    .from("reports")
    .select("id, name")
    .eq("id", reportId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle<{ id: string; name: string }>();

  if (reportErr) {
    return NextResponse.json({ error: reportErr.message }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  if (report.name.startsWith(ARCHIVE_PREFIX)) {
    return NextResponse.json({ ok: true });
  }

  const { error: updateErr } = await adminClient
    .from("reports")
    .update({ name: `${ARCHIVE_PREFIX}${report.name}` })
    .eq("id", reportId)
    .eq("tenant_id", profile.tenant_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
