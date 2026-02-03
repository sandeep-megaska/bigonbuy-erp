begin;

-- Safety: gen_random_uuid() dependency
create extension if not exists "pgcrypto";

-- 1) Canonical mapping: HR designation -> permission (by permission_id, not perm_key)
create table if not exists public.erp_rbac_hr_designation_permissions (
  id uuid primary key default gen_random_uuid(),
  hr_designation_id uuid not null references public.erp_hr_designations (id),
  permission_id uuid not null references public.erp_rbac_permissions (id),
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint erp_rbac_hr_designation_permissions_hr_designation_permission_unique
    unique (hr_designation_id, permission_id)
);

-- 2) Employee permissions (v2) based on HR designation (current job)
drop function if exists public.erp_employee_permissions_get_v2(uuid, uuid);
create or replace function public.erp_employee_permissions_get_v2(
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
  v_hr_designation_id uuid;
begin
  if p_company_id is null or p_employee_id is null then
    return;
  end if;

  -- IMPORTANT: in your system, current_jobs.designation_id stores HR designation id
  select j.designation_id
    into v_hr_designation_id
  from public.erp_employee_current_jobs j
  where j.company_id = p_company_id
    and j.employee_id = p_employee_id
    and j.effective_from <= current_date
    and (j.effective_to is null or j.effective_to >= current_date)
  order by j.effective_from desc, j.created_at desc
  limit 1;

  if v_hr_designation_id is null then
    return;
  end if;

  return query
  select p.perm_key,
         p.module_key
  from public.erp_rbac_permissions p
  join public.erp_rbac_hr_designation_permissions dp
    on dp.permission_id = p.id
   and dp.hr_designation_id = v_hr_designation_id
   and dp.allowed
  where p.company_id = p_company_id
    and p.is_active
  order by p.module_key, p.perm_key;
end;
$$;

revoke all on function public.erp_employee_permissions_get_v2(uuid, uuid) from public;
grant execute on function public.erp_employee_permissions_get_v2(uuid, uuid) to authenticated;

-- 3) HR admin helpers for the RBAC screen (HR designations)
drop function if exists public.erp_rbac_hr_designation_permissions_get(uuid, uuid);
create or replace function public.erp_rbac_hr_designation_permissions_get(
  p_company_id uuid,
  p_hr_designation_id uuid
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
  if p_company_id is null or p_hr_designation_id is null then
    raise exception 'company_id and hr_designation_id are required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
    if v_company_id is null or v_company_id <> p_company_id then
      raise exception 'Not authorized';
    end if;
  end if;

  -- Ensure designation belongs to company (prevents cross-company reads)
  if not exists (
    select 1 from public.erp_hr_designations d
    where d.id = p_hr_designation_id
      and d.company_id = p_company_id
  ) then
    raise exception 'HR designation not found';
  end if;

  return query
  select p.perm_key,
         p.label,
         p.module_key,
         coalesce(dp.allowed, false) as allowed
    from public.erp_rbac_permissions p
    left join public.erp_rbac_hr_designation_permissions dp
      on dp.permission_id = p.id
     and dp.hr_designation_id = p_hr_designation_id
   where p.company_id = p_company_id
     and p.is_active
   order by p.module_key, p.perm_key;
end;
$$;

revoke all on function public.erp_rbac_hr_designation_permissions_get(uuid, uuid) from public;
grant execute on function public.erp_rbac_hr_designation_permissions_get(uuid, uuid) to authenticated;

drop function if exists public.erp_rbac_hr_designation_permissions_set(uuid, uuid, text, boolean);
create or replace function public.erp_rbac_hr_designation_permissions_set(
  p_company_id uuid,
  p_hr_designation_id uuid,
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
  if p_company_id is null or p_hr_designation_id is null then
    raise exception 'company_id and hr_designation_id are required';
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

  -- Ensure designation belongs to company (prevents cross-company writes)
  if not exists (
    select 1 from public.erp_hr_designations d
    where d.id = p_hr_designation_id
      and d.company_id = p_company_id
  ) then
    raise exception 'HR designation not found';
  end if;

  -- Resolve permission_id scoped to company
  select p.id
    into v_permission_id
  from public.erp_rbac_permissions p
  where p.company_id = p_company_id
    and p.perm_key = trim(p_perm_key);

  if v_permission_id is null then
    raise exception 'Permission not found';
  end if;

  insert into public.erp_rbac_hr_designation_permissions (
    hr_designation_id,
    permission_id,
    allowed,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    p_hr_designation_id,
    v_permission_id,
    p_allowed,
    now(),
    v_actor,
    now(),
    v_actor
  )
  on conflict (hr_designation_id, permission_id)
  do update set
    allowed = excluded.allowed,
    updated_at = now(),
    updated_by = v_actor;
end;
$$;

revoke all on function public.erp_rbac_hr_designation_permissions_set(uuid, uuid, text, boolean) from public;
grant execute on function public.erp_rbac_hr_designation_permissions_set(uuid, uuid, text, boolean) to authenticated;

commit;
