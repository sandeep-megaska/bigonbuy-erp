-- Company user invitation flow

-- Ensure unique membership per company/user pair
create unique index if not exists ux_erp_company_users_company_user
  on public.erp_company_users (company_id, user_id);

-- Helper to check if current auth user can manage company
create or replace function public.erp_can_manage_company()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.erp_company_users
    where user_id = auth.uid()
      and role_key in ('owner', 'admin', 'hr')
  );
$$;

revoke all on function public.erp_can_manage_company() from public;
grant execute on function public.erp_can_manage_company() to authenticated;

-- RPC: invite or update a company user membership
create or replace function public.erp_invite_company_user(
  p_target_user_id uuid,
  p_role_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id constant uuid := 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.erp_company_users
    where company_id = v_company_id
      and user_id = auth.uid()
      and role_key in ('owner', 'admin', 'hr')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_role_key not in ('admin', 'hr', 'employee') then
    raise exception 'Invalid role: %', p_role_key;
  end if;

  if not exists (select 1 from public.erp_roles where key = p_role_key) then
    raise exception 'Role not found in erp_roles: %', p_role_key;
  end if;

  insert into public.erp_company_users (company_id, user_id, role_key, updated_at)
  values (v_company_id, p_target_user_id, p_role_key, now())
  on conflict (company_id, user_id) do update
    set role_key = excluded.role_key,
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'company_id', v_company_id,
    'user_id', p_target_user_id,
    'role_key', p_role_key
  );
end;
$$;

revoke all on function public.erp_invite_company_user(uuid, text) from public;
grant execute on function public.erp_invite_company_user(uuid, text) to authenticated;
