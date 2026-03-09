import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { AppRole } from "@/lib/roles";
import { hasManagerAccess } from "@/lib/roles";

const ISSUE_PREFIX = "__ISSUE__:";
const NEXT_SHUT_PREFIX = "__NEXT_SHUT__:";
const EMERGENT_PREFIX = "__EMERGENT__:";

type WoUpdateRow = {
  id: string;
  work_order_id: string;
  comment: string | null;
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
    .single<{ tenant_id: string | null; role: AppRole }>();

  if (profileErr || !profile?.tenant_id) {
    return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  }

  if (!hasManagerAccess(profile.role)) {
    return NextResponse.json({ error: "Only managers and owners can edit saved completion comments." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const updateId = typeof body?.updateId === "string" ? body.updateId : "";
  const nextCommentInput = typeof body?.comment === "string" ? body.comment.trim() : "";
  const entryKind = body?.entryKind === "issue" ? "issue" : "completion";

  if (!updateId) {
    return NextResponse.json({ error: "Missing updateId." }, { status: 400 });
  }
  if (!nextCommentInput) {
    return NextResponse.json({ error: "Comment cannot be empty." }, { status: 400 });
  }

  const { data: existingUpdate, error: updErr } = await adminClient
    .from("wo_updates")
    .select("id, work_order_id, comment")
    .eq("id", updateId)
    .maybeSingle<WoUpdateRow>();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!existingUpdate) return NextResponse.json({ error: "Saved comment not found." }, { status: 404 });

  if (entryKind === "completion") {
    if (
      existingUpdate.comment?.startsWith(ISSUE_PREFIX) ||
      existingUpdate.comment?.startsWith(EMERGENT_PREFIX)
    ) {
      return NextResponse.json({ error: "Only completion comments can be edited from this action." }, { status: 400 });
    }
  } else if (!existingUpdate.comment?.startsWith(ISSUE_PREFIX)) {
    return NextResponse.json({ error: "Only logged issues/recommendations can be edited from this action." }, { status: 400 });
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
    return NextResponse.json({ error: "Saved comment not found." }, { status: 404 });
  }

  const nextComment =
    entryKind === "issue"
      ? `${ISSUE_PREFIX} ${nextCommentInput}`.trim()
      : existingUpdate.comment?.startsWith(NEXT_SHUT_PREFIX)
        ? `${NEXT_SHUT_PREFIX} ${nextCommentInput}`.trim()
        : nextCommentInput;

  const { error: saveErr } = await adminClient
    .from("wo_updates")
    .update({ comment: nextComment })
    .eq("id", updateId);

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
