"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export type AppRole = "contributor" | "supervisor" | "manager";

export type Profile = {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
  role: AppRole;
};

export function useProfile() {
  const supabase = createSupabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setUserId(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    setUserId(userRes.user.id);

    const { data, error: pErr } = await supabase
      .from("profiles")
      .select("id, tenant_id, full_name, role")
      .eq("id", userRes.user.id)
      .single();

    if (pErr) {
      setError(pErr.message);
      setProfile(null);
    } else {
      setProfile(data as Profile);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loading, userId, profile, error, reload: load };
}
