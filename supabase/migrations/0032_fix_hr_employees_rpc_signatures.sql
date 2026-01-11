-- 0032_fix_hr_employees_rpc_signatures.sql

-- Helper guards
create or replace function public.erp_require_hr_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_hr_writer() from public;
grant execute on function public.erp_require_hr_writer() to authenticated;

-- Prevent cycles in manager hierarchy
create or replace function public.erp_hr_validate_manager_chain(
  p_employee_id uuid,
  p_manager_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle boolean;
  v_company_id uuid := public.erp_current_company_id();
begin
  if p_manager_id is null then
    return;
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_manager_id = p_employee_id then
    raise exception 'Manager cycle detected';
  end if;

  with recursive chain as (
    select e.id, e.manager_employee_id
    from public.erp_employees e
    where e.id = p_manager_id
      and e.company_id = v_company_id
    union all
    select m.id, m.manager_employee_id
    from public.erp_employees m
    join chain c on m.id = c.manager_employee_id
    where m.company_id = v_company_id
  )
  select exists (
    select 1 from chain where id = p_employee_id
  ) into v_cycle;

  if v_cycle then
    raise exception 'Manager cycle detected';
  end if;
end;
$$;

revoke all on function public.erp_hr_validate_manager_chain(uuid, uuid) from public;
grant execute on function public.erp_hr_validate_manager_chain(uuid, uuid) to authenticated;

-- Onboarding / upsert RPCs
create or replace function public.erp_hr_employee_upsert(
  p_full_name text,
  p_id uuid default null,
  p_employee_code text default null,
  p_user_id uuid default null,
  p_manager_employee_id uuid default null,
  p_is_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid;
  v_has_updated_at boolean;
  v_status text;
begin
  perform public.erp_require_hr_writer();

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  if p_manager_employee_id is not null then
    if not exists (
      select 1
      from public.erp_employees m
      where m.id = p_manager_employee_id
        and m.company_id = v_company_id
    ) then
      raise exception 'Invalid manager_employee_id';
    end if;
  end if;

  v_status := case when coalesce(p_is_active, true) then 'active' else 'inactive' end;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employees'
      and column_name = 'updated_at'
  ) into v_has_updated_at;

  if p_id is null then
    insert into public.erp_employees (
      company_id,
      full_name,
      employee_code,
      user_id,
      manager_employee_id,
      employment_status
    ) values (
      v_company_id,
      trim(p_full_name),
      nullif(trim(coalesce(p_employee_code, '')), ''),
      p_user_id,
      p_manager_employee_id,
      v_status
    )
    returning id into v_employee_id;

    perform public.erp_hr_validate_manager_chain(v_employee_id, p_manager_employee_id);
  else
    v_employee_id := p_id;

    if not exists (
      select 1
      from public.erp_employees e
      where e.id = p_id
        and e.company_id = v_company_id
    ) then
      raise exception 'Employee not found';
    end if;

    perform public.erp_hr_validate_manager_chain(p_id, p_manager_employee_id);

    if v_has_updated_at then
      update public.erp_employees
      set full_name = trim(p_full_name),
          employee_code = coalesce(nullif(trim(coalesce(p_employee_code, '')), ''), employee_code),
          user_id = p_user_id,
          manager_employee_id = p_manager_employee_id,
          employment_status = v_status,
          updated_at = now()
      where id = p_id
        and company_id = v_company_id;
    else
      update public.erp_employees
      set full_name = trim(p_full_name),
          employee_code = coalesce(nullif(trim(coalesce(p_employee_code, '')), ''), employee_code),
          user_id = p_user_id,
          manager_employee_id = p_manager_employee_id,
          employment_status = v_status
      where id = p_id
        and company_id = v_company_id;
    end if;
  end if;

  return v_employee_id;
end;
$$;

create or replace function public.erp_hr_employee_assign_manager(
  p_employee_id uuid,
  p_manager_employee_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_has_updated_at boolean;
begin
  perform public.erp_require_hr_writer();

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Employee not found';
  end if;

  if p_manager_employee_id is not null then
    if not exists (
      select 1
      from public.erp_employees m
      where m.id = p_manager_employee_id
        and m.company_id = v_company_id
    ) then
      raise exception 'Invalid manager_employee_id';
    end if;
  end if;

  perform public.erp_hr_validate_manager_chain(p_employee_id, p_manager_employee_id);

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employees'
      and column_name = 'updated_at'
  ) into v_has_updated_at;

  if v_has_updated_at then
    update public.erp_employees
    set manager_employee_id = p_manager_employee_id,
        updated_at = now()
    where id = p_employee_id
      and company_id = v_company_id;
  else
    update public.erp_employees
    set manager_employee_id = p_manager_employee_id
    where id = p_employee_id
      and company_id = v_company_id;
  end if;
end;
$$;

revoke all on function public.erp_hr_employee_upsert(text, uuid, text, uuid, uuid, boolean) from public;
grant execute on function public.erp_hr_employee_upsert(text, uuid, text, uuid, uuid, boolean) to authenticated;

revoke all on function public.erp_hr_employee_assign_manager(uuid, uuid) from public;
grant execute on function public.erp_hr_employee_assign_manager(uuid, uuid) to authenticated;

-- Role assignment RPC
create or replace function public.erp_hr_assign_user_role(
  p_user_id uuid,
  p_role_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_owner_count int;
begin
  perform public.erp_require_hr_writer();

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  v_target_role := nullif(trim(coalesce(p_role_key, '')), '');
  if v_target_role is null or v_target_role not in ('owner', 'admin', 'hr', 'employee') then
    raise exception 'Invalid role_key';
  end if;

  select cu.role_key
    into v_actor_role
    from public.erp_company_users cu
   where cu.company_id = v_company_id
     and cu.user_id = v_actor
     and coalesce(cu.is_active, true)
   limit 1;

  if v_target_role in ('owner', 'admin') and v_actor_role <> 'owner' then
    raise exception 'Only owner can assign owner/admin roles';
  end if;

  if v_target_role <> 'owner' then
    select count(*)
      into v_owner_count
      from public.erp_company_users cu
     where cu.company_id = v_company_id
       and cu.role_key = 'owner'
       and coalesce(cu.is_active, true);

    if v_owner_count <= 1 and exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = p_user_id
        and cu.role_key = 'owner'
        and coalesce(cu.is_active, true)
    ) then
      raise exception 'Cannot remove last owner';
    end if;
  end if;

  insert into public.erp_company_users (
    company_id,
    user_id,
    role_key,
    is_active,
    updated_at
  ) values (
    v_company_id,
    p_user_id,
    v_target_role,
    true,
    now()
  )
  on conflict (company_id, user_id) do update
    set role_key = excluded.role_key,
        is_active = true,
        updated_at = now();
end;
$$;

revoke all on function public.erp_hr_assign_user_role(uuid, text) from public;
grant execute on function public.erp_hr_assign_user_role(uuid, text) to authenticated;

-- Optional invite/link helper
create or replace function public.erp_hr_employee_link_user(
  p_employee_id uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_hr_writer();

  if p_employee_id is null or p_user_id is null then
    raise exception 'employee_id and user_id are required';
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Employee not found';
  end if;

  update public.erp_employees
  set user_id = p_user_id
  where id = p_employee_id
    and company_id = v_company_id;

  insert into public.erp_company_users (
    company_id,
    user_id,
    role_key,
    is_active,
    updated_at
  ) values (
    v_company_id,
    p_user_id,
    'employee',
    true,
    now()
  )
  on conflict (company_id, user_id) do update
    set is_active = true,
        updated_at = now();
end;
$$;

revoke all on function public.erp_hr_employee_link_user(uuid, uuid) from public;
grant execute on function public.erp_hr_employee_link_user(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
