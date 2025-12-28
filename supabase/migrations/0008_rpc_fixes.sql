-- Ensure key RPCs exist with correct signatures and authorization

-- Manager predicate (owner/admin/hr) using canonical company id
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

  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' and auth.uid() <> uid then
    if not exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = auth.uid()
        and coalesce(cu.is_active, true)
        and cu.role_key in ('owner', 'admin', 'hr')
    ) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
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

-- Employee list RPC with canonical company selection and manager gate
create or replace function public.erp_list_employees()
returns table (
  id uuid,
  company_id uuid,
  employee_no text,
  full_name text,
  work_email text,
  personal_email text,
  phone text,
  joining_date date,
  status text,
  department text,
  designation text,
  designation_id uuid,
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

  if auth.role() <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Not authenticated';
    end if;

    if not public.is_erp_manager(auth.uid()) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
  end if;

  return query
  select
    e.id,
    coalesce(e.company_id, v_company_id) as company_id,
    e.employee_no,
    e.full_name,
    e.work_email,
    e.personal_email,
    e.phone,
    e.joining_date,
    e.status,
    e.department,
    e.designation,
    e.designation_id,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  where coalesce(e.company_id, v_company_id) = v_company_id
  order by e.joining_date desc nulls last, e.created_at desc;
end;
$$;

revoke all on function public.erp_list_employees() from public;
grant execute on function public.erp_list_employees() to authenticated;
