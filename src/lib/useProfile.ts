"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Types that match your Supabase schema
 */
export type AppRole = "contributor" | "supervisor" | "manager";

export type Profile = {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
  role: AppRole;
};

/**
 * React hook to load:
 *  - Supabase auth user
 *  - Matching profile row (tenant + role)
 */
export function useProfile() {
  const supabase = createSupabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProfile() {
    setLoading(true);
    setError(null);

    // Get logged-in user
    const { data: userRes, error: userErr } = await supabase.auth.getUser();

    if (userErr || !userRes.user) {
      setUserId(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    const user = userRes.user;
    setUserId(user.id);

    // Load profile row tied to that user
    const { data, error: profileErr } = await supabase
      .from("profiles")
      .select("id, tenant_id, full_name, role")
      .eq("id", user.id)
      .single();

    if (profileErr) {
      setError(profileErr.message);
      setProfile(null);
    } else {
      setProfile(data as Profile);
    }

    setLoading(false);
  }

  // Load once on mount
  useEffect(() => {
    loadProfile();

    // Re-load if auth changes (login/logout)
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadProfile();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    loading,
    userId,
    profile,
    error,
    reload: loadProfile,
  };
}
