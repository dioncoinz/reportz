import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

export async function POST(req: NextRequest) {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
  const { id, reason } = await req.json();

  await supabase
    .from("work_orders")
    .update({ cancelled_reason: reason })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
