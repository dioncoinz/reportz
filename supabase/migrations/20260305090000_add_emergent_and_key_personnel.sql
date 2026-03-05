alter table if exists public.work_orders
  add column if not exists emergent_work boolean not null default false;

alter table if exists public.reports
  add column if not exists key_personnel text;
