alter table if exists public.reports
  add column if not exists client_name text;

alter table if exists public.reports
  add column if not exists shutdown_name text;
