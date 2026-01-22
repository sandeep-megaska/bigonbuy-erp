alter table public.erp_company_settings
  add column if not exists gmail_user text;

alter table public.erp_company_settings
  add column if not exists gmail_connected boolean not null default false;

alter table public.erp_company_settings
  add column if not exists gmail_last_synced_at timestamptz;

create or replace function public.erp_company_settings_get()
returns table (
  company_id uuid,
  gmail_user text,
  gmail_connected boolean,
  gmail_last_synced_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    cs.company_id,
    cs.gmail_user,
    cs.gmail_connected,
    cs.gmail_last_synced_at
  from public.erp_company_settings cs
  where cs.company_id = public.erp_current_company_id();
end;
$$;

revoke all on function public.erp_company_settings_get() from public;
grant execute on function public.erp_company_settings_get() to authenticated;

create or replace function public.erp_company_settings_update_gmail(
  p_gmail_user text,
  p_connected boolean,
  p_last_synced_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_row public.erp_company_settings;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Not authorized';
  end if;

  update public.erp_company_settings
     set gmail_user = coalesce(p_gmail_user, gmail_user),
         gmail_connected = coalesce(p_connected, gmail_connected),
         gmail_last_synced_at = coalesce(p_last_synced_at, gmail_last_synced_at),
         updated_by = v_actor
   where company_id = v_company_id
  returning * into v_row;

  if v_row.company_id is null then
    raise exception 'Company settings not found';
  end if;
end;
$$;

revoke all on function public.erp_company_settings_update_gmail(text, boolean, timestamptz) from public;
grant execute on function public.erp_company_settings_update_gmail(text, boolean, timestamptz) to authenticated;
