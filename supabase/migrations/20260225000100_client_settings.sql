create table if not exists public.client_settings (
  id integer primary key default 1 check (id = 1),
  client_name text,
  terminology jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  report_header jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.client_settings enable row level security;

create or replace function public.set_client_settings_updated_fields()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_client_settings_updated_fields on public.client_settings;
create trigger trg_client_settings_updated_fields
before update on public.client_settings
for each row
execute function public.set_client_settings_updated_fields();

insert into public.client_settings (id, client_name)
values (1, 'Reportz')
on conflict (id) do nothing;

drop policy if exists client_settings_select_authenticated on public.client_settings;
create policy client_settings_select_authenticated
on public.client_settings
for select
to authenticated
using (true);

drop policy if exists client_settings_insert_supervisor_manager on public.client_settings;
create policy client_settings_insert_supervisor_manager
on public.client_settings
for insert
to authenticated
with check (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role]));

drop policy if exists client_settings_update_supervisor_manager on public.client_settings;
create policy client_settings_update_supervisor_manager
on public.client_settings
for update
to authenticated
using (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role]))
with check (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role]));

