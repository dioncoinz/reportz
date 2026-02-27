import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type AppRole = "contributor" | "supervisor" | "manager";

const allowedRoles: AppRole[] = ["contributor", "supervisor", "manager"];

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, anonKey);
  const { data: userRes, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !userRes.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: actorProfile, error: actorProfileErr } = await adminClient
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", userRes.user.id)
    .single<{ tenant_id: string | null; role: AppRole }>();

  if (actorProfileErr || !actorProfile?.tenant_id) {
    return NextResponse.json({ error: "Profile tenant_id not set." }, { status: 403 });
  }
  if (actorProfile.role !== "manager") {
    return NextResponse.json({ error: "Only managers can invite users." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "").trim();
  const fullName = String(body?.fullName ?? "").trim();
  const role = String(body?.role ?? "contributor").trim() as AppRole;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || email },
  });

  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message ?? "Failed to create user." }, { status: 400 });
  }

  const { error: profileErr } = await adminClient.from("profiles").upsert(
    {
      id: created.user.id,
      tenant_id: actorProfile.tenant_id,
      full_name: fullName || created.user.email || email,
      role,
    },
    { onConflict: "id" }
  );

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: created.user.id,
      email: created.user.email,
      role,
    },
  });
}

