-- Employee portal access admin RPCs

drop function if exists public.erp_employee_auth_user_get_by_employee_id(uuid, uuid);

create function public.erp_employee_auth_user_get_by_employee_id(
  p_company_id uuid,
  p_employee_id uuid
) returns table (
  employee_id uuid,
  employee_code text,
  is_active boolean,
  must_reset_password boolean,
  last_login_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_authorized boolean := false;
begin
  if p_company_id is null or p_employee_id is null then
    raise exception 'company_id and employee_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  return query
  select
    e.id as employee_id,
    e.employee_code,
    au.is_active,
    au.must_reset_password,
    au.last_login_at
  from public.erp_employees e
  left join public.erp_employee_auth_users au
    on au.employee_id = e.id
   and au.company_id = e.company_id
  where e.company_id = p_company_id
    and e.id = p_employee_id;
end;
$$;

revoke all on function public.erp_employee_auth_user_get_by_employee_id(uuid, uuid) from public;
grant execute on function public.erp_employee_auth_user_get_by_employee_id(uuid, uuid) to authenticated;

drop function if exists public.erp_employee_auth_user_set_active(uuid, uuid, boolean, uuid);

create function public.erp_employee_auth_user_set_active(
  p_company_id uuid,
  p_employee_id uuid,
  p_is_active boolean,
  p_actor_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_is_authorized boolean := false;
begin
  if p_company_id is null or p_employee_id is null or p_actor_user_id is null or p_is_active is null then
    raise exception 'company_id, employee_id, is_active, and actor_user_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = p_actor_user_id
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  select au.id
    into v_existing_id
  from public.erp_employee_auth_users au
  where au.company_id = p_company_id
    and au.employee_id = p_employee_id;

  if v_existing_id is null then
    raise exception 'Employee portal access not found';
  end if;

  update public.erp_employee_auth_users
     set is_active = p_is_active,
         updated_at = now(),
         updated_by = p_actor_user_id
   where id = v_existing_id;

  return true;
end;
$$;

revoke all on function public.erp_employee_auth_user_set_active(uuid, uuid, boolean, uuid) from public;
grant execute on function public.erp_employee_auth_user_set_active(uuid, uuid, boolean, uuid) to authenticated;
