begin;

create extension if not exists "pgcrypto";

create table if not exists public.erp_rbac_permissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  perm_key text not null,
  label text not null,
  module_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint erp_rbac_permissions_company_perm_key unique (company_id, perm_key)
);

create table if not exists public.erp_rbac_designation_permissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  designation_id uuid not null references public.erp_designations (id),
  permission_id uuid not null references public.erp_rbac_permissions (id),
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint erp_rbac_designation_permissions_company_designation_permission_key
    unique (company_id, designation_id, permission_id)
);

insert into public.erp_rbac_permissions (company_id, perm_key, label, module_key)
select c.id,
       v.perm_key,
       v.label,
       v.module_key
from public.erp_companies c
cross join (
  values
    ('inventory_read', 'Inventory - Read', 'inventory'),
    ('inventory_write', 'Inventory - Write', 'inventory'),
    ('inventory_stocktake', 'Inventory - Stocktake', 'inventory'),
    ('inventory_transfer', 'Inventory - Transfer', 'inventory'),
    ('hr_self_profile', 'HR Self Service - Profile', 'self-service'),
    ('hr_self_leave', 'HR Self Service - Leave', 'self-service'),
    ('hr_self_exit', 'HR Self Service - Exit', 'self-service')
) as v(perm_key, label, module_key)
on conflict (company_id, perm_key) do nothing;

-- Employee realm helpers

drop function if exists public.erp_employee_current_designation_id(uuid, uuid);
create or replace function public.erp_employee_current_designation_id(
  p_company_id uuid,
  p_employee_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_designation_id uuid;
begin
  if p_company_id is null or p_employee_id is null then
    return null;
  end if;

  select j.designation_id
    into v_designation_id
  from public.erp_employee_current_jobs j
  where j.company_id = p_company_id
    and j.employee_id = p_employee_id
    and j.effective_from <= current_date
    and (j.effective_to is null or j.effective_to >= current_date)
  order by j.effective_from desc, j.created_at desc
  limit 1;

  if v_designation_id is null then
    select e.designation_id
      into v_designation_id
    from public.erp_employees e
    where e.company_id = p_company_id
      and e.id = p_employee_id;
  end if;

  return v_designation_id;
end;
$$;

revoke all on function public.erp_employee_current_designation_id(uuid, uuid) from public;
grant execute on function public.erp_employee_current_designation_id(uuid, uuid) to authenticated;

drop function if exists public.erp_employee_has_permission(uuid, uuid, text);
create or replace function public.erp_employee_has_permission(
  p_company_id uuid,
  p_employee_id uuid,
  p_perm_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_designation_id uuid;
  v_permission_id uuid;
begin
  if p_company_id is null or p_employee_id is null then
    return false;
  end if;

  if p_perm_key is null or trim(p_perm_key) = '' then
    return false;
  end if;

  v_designation_id := public.erp_employee_current_designation_id(p_company_id, p_employee_id);
  if v_designation_id is null then
    return false;
  end if;

  select p.id
    into v_permission_id
  from public.erp_rbac_permissions p
  where p.company_id = p_company_id
    and p.perm_key = p_perm_key
    and p.is_active;

  if v_permission_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.erp_rbac_designation_permissions dp
    where dp.company_id = p_company_id
      and dp.designation_id = v_designation_id
      and dp.permission_id = v_permission_id
      and dp.allowed
  );
end;
$$;

revoke all on function public.erp_employee_has_permission(uuid, uuid, text) from public;
grant execute on function public.erp_employee_has_permission(uuid, uuid, text) to authenticated;

drop function if exists public.erp_employee_permissions_get(uuid, uuid);
create or replace function public.erp_employee_permissions_get(
  p_company_id uuid,
  p_employee_id uuid
) returns table (
  perm_key text,
  module_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_designation_id uuid;
begin
  if p_company_id is null or p_employee_id is null then
    return;
  end if;

  v_designation_id := public.erp_employee_current_designation_id(p_company_id, p_employee_id);
  if v_designation_id is null then
    return;
  end if;

  return query
  select p.perm_key,
         p.module_key
    from public.erp_rbac_permissions p
    join public.erp_rbac_designation_permissions dp
      on dp.permission_id = p.id
     and dp.company_id = p_company_id
     and dp.designation_id = v_designation_id
     and dp.allowed
   where p.company_id = p_company_id
     and p.is_active
   order by p.module_key, p.perm_key;
end;
$$;

revoke all on function public.erp_employee_permissions_get(uuid, uuid) from public;
grant execute on function public.erp_employee_permissions_get(uuid, uuid) to authenticated;

-- HR/Admin RPCs

drop function if exists public.erp_rbac_permissions_list(uuid);
create or replace function public.erp_rbac_permissions_list(
  p_company_id uuid
) returns table (
  permission_id uuid,
  perm_key text,
  label text,
  module_key text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
    if v_company_id is null or v_company_id <> p_company_id then
      raise exception 'Not authorized';
    end if;
  end if;

  return query
  select p.id,
         p.perm_key,
         p.label,
         p.module_key,
         p.is_active
    from public.erp_rbac_permissions p
   where p.company_id = p_company_id
   order by p.module_key, p.perm_key;
end;
$$;

revoke all on function public.erp_rbac_permissions_list(uuid) from public;
grant execute on function public.erp_rbac_permissions_list(uuid) to authenticated;

drop function if exists public.erp_rbac_designation_permissions_get(uuid, uuid);
create or replace function public.erp_rbac_designation_permissions_get(
  p_company_id uuid,
  p_designation_id uuid
) returns table (
  perm_key text,
  label text,
  module_key text,
  allowed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if p_company_id is null or p_designation_id is null then
    raise exception 'company_id and designation_id are required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
    if v_company_id is null or v_company_id <> p_company_id then
      raise exception 'Not authorized';
    end if;
  end if;

  return query
  select p.perm_key,
         p.label,
         p.module_key,
         coalesce(dp.allowed, false) as allowed
    from public.erp_rbac_permissions p
    left join public.erp_rbac_designation_permissions dp
      on dp.permission_id = p.id
     and dp.company_id = p_company_id
     and dp.designation_id = p_designation_id
   where p.company_id = p_company_id
   order by p.module_key, p.perm_key;
end;
$$;

revoke all on function public.erp_rbac_designation_permissions_get(uuid, uuid) from public;
grant execute on function public.erp_rbac_designation_permissions_get(uuid, uuid) to authenticated;

drop function if exists public.erp_rbac_designation_permissions_set(uuid, uuid, text, boolean);
create or replace function public.erp_rbac_designation_permissions_set(
  p_company_id uuid,
  p_designation_id uuid,
  p_perm_key text,
  p_allowed boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_permission_id uuid;
begin
  if p_company_id is null or p_designation_id is null then
    raise exception 'company_id and designation_id are required';
  end if;

  if p_perm_key is null or trim(p_perm_key) = '' then
    raise exception 'perm_key is required';
  end if;

  if p_allowed is null then
    raise exception 'allowed is required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
    if v_company_id is null or v_company_id <> p_company_id then
      raise exception 'Not authorized';
    end if;
  end if;

  select p.id
    into v_permission_id
  from public.erp_rbac_permissions p
  where p.company_id = p_company_id
    and p.perm_key = p_perm_key;

  if v_permission_id is null then
    raise exception 'Permission not found';
  end if;

  insert into public.erp_rbac_designation_permissions (
    company_id,
    designation_id,
    permission_id,
    allowed,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    p_company_id,
    p_designation_id,
    v_permission_id,
    p_allowed,
    now(),
    v_actor,
    now(),
    v_actor
  )
  on conflict (company_id, designation_id, permission_id)
  do update set
    allowed = excluded.allowed,
    updated_at = now(),
    updated_by = v_actor;
end;
$$;

revoke all on function public.erp_rbac_designation_permissions_set(uuid, uuid, text, boolean) from public;
grant execute on function public.erp_rbac_designation_permissions_set(uuid, uuid, text, boolean) to authenticated;

commit;
