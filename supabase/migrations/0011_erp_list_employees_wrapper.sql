drop function if exists public.erp_list_employees();

-- Ensure manager predicate aligns to canonical single-company setup
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select id into v_company_id
  from public.erp_companies
  limit 1;

  if v_company_id is null then
    return false;
  end if;

  if uid is null then
    return false;
  end if;

  return exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = uid
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  );
end;
$$;

revoke all on function public.is_erp_manager(uuid) from public;
grant execute on function public.is_erp_manager(uuid) to authenticated;

-- Manager-only employee directory RPC with no parameters
create function public.erp_list_employees()
returns table (
  id uuid,
  employee_no text,
  full_name text,
  work_email text,
  phone text,
  department text,
  status text,
  designation_id uuid,
  designation_name text,
  user_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select id into v_company_id
  from public.erp_companies
  limit 1;

  if v_company_id is null then
    raise exception 'No company configured';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  return query
  select
    e.id,
    e.employee_no,
    e.full_name,
    e.work_email,
    e.phone,
    e.department,
    e.status,
    e.designation_id,
    d.name as designation_name,
    e.user_id,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  left join public.erp_designations d on d.id = e.designation_id
  where coalesce(e.company_id, v_company_id) = v_company_id
  order by e.joining_date desc nulls last, e.created_at desc;
end;
$$;

revoke all on function public.erp_list_employees() from public;
grant execute on function public.erp_list_employees() to authenticated;
