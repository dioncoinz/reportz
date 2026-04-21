import { createSupabaseServer } from "@/lib/supabase/server";

export type AppRole = "contributor" | "supervisor" | "manager";

export async function getCurrentProfile() {
  const supabase = await createSupabaseServer();

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) return { user: null, profile: null };

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, tenant_id, full_name, role")
    .eq("id", userRes.user.id)
    .single();

  if (profileErr) return { user: userRes.user, profile: null };

  return { user: userRes.user, profile };
}
