alter table if exists public.reports
  add column if not exists vendor_key_contacts text;

alter table if exists public.reports
  add column if not exists client_key_contacts text;
