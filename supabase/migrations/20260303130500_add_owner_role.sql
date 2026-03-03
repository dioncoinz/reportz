do $$
begin
  begin
    alter type public.app_role add value 'owner';
  exception
    when duplicate_object then null;
  end;
end $$;
