drop policy if exists client_settings_insert_supervisor_manager on public.client_settings;
create policy client_settings_insert_supervisor_manager
on public.client_settings
for insert
to authenticated
with check (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]));

drop policy if exists client_settings_update_supervisor_manager on public.client_settings;
create policy client_settings_update_supervisor_manager
on public.client_settings
for update
to authenticated
using (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]))
with check (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]));

drop policy if exists tenant_branding_update_supervisor_manager on public.tenant_branding;
create policy tenant_branding_update_supervisor_manager
on public.tenant_branding
for update
to authenticated
using (
  (tenant_id = (
    select p.tenant_id
    from public.profiles p
    where p.id = auth.uid()
  ))
  and (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]))
)
with check (
  (tenant_id = (
    select p.tenant_id
    from public.profiles p
    where p.id = auth.uid()
  ))
  and (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]))
);

drop policy if exists tenant_branding_upsert_supervisor_manager on public.tenant_branding;
create policy tenant_branding_upsert_supervisor_manager
on public.tenant_branding
for insert
to authenticated
with check (
  (tenant_id = (
    select p.tenant_id
    from public.profiles p
    where p.id = auth.uid()
  ))
  and (public.current_role() = any (array['supervisor'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]))
);

