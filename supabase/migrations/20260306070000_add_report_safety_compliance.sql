alter table if exists public.reports
  add column if not exists safety_injuries integer not null default 0;

alter table if exists public.reports
  add column if not exists safety_incidents integer not null default 0;
