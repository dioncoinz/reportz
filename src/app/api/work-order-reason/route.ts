import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const { id, reason } = await req.json();

  await supabase
    .from("work_orders")
    .update({ cancelled_reason: reason })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
