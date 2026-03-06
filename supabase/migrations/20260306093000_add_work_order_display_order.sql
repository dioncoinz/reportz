alter table if exists public.work_orders
  add column if not exists display_order integer;
