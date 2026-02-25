import { cache } from "react";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { TerminologyMap } from "@/clients/types";

export type ClientSettingsRow = {
  id: number;
  client_name: string | null;
  terminology: TerminologyMap | null;
  feature_flags: Record<string, boolean> | null;
  report_header: Record<string, string> | null;
  updated_at: string;
};

export const getClientSettings = cache(async (): Promise<ClientSettingsRow | null> => {
  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from("client_settings")
    .select("id, client_name, terminology, feature_flags, report_header, updated_at")
    .eq("id", 1)
    .maybeSingle<ClientSettingsRow>();

  if (error) return null;
  return data ?? null;
});

export function mergeTerminology(base: TerminologyMap, overrides?: TerminologyMap | null): TerminologyMap {
  return { ...base, ...(overrides ?? {}) };
}

export function t(terms: TerminologyMap, key: string, fallback: string) {
  return terms[key] ?? fallback;
}

