alter table if exists public.reports
  add column if not exists key_personnel text;
