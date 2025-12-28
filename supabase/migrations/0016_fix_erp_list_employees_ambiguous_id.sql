-- Fix ambiguous id reference in erp_list_employees

create or replace function public.erp_list_employees()
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
  v_has_designations boolean;
begin
  select c.id into v_company_id
  from public.erp_companies c
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

  select to_regclass('public.erp_designations') is not null into v_has_designations;

  if v_has_designations then
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
      eu.user_id,
      e.created_at,
      e.updated_at
    from public.erp_employees e
    left join public.erp_designations d on d.id = e.designation_id
    left join public.erp_employee_users eu
      on eu.employee_id = e.id
     and coalesce(eu.company_id, v_company_id) = v_company_id
     and coalesce(eu.is_active, true)
    where coalesce(e.company_id, v_company_id) = v_company_id
    order by e.joining_date desc nulls last, e.created_at desc;
  else
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
      null::text as designation_name,
      eu.user_id,
      e.created_at,
      e.updated_at
    from public.erp_employees e
    left join public.erp_employee_users eu
      on eu.employee_id = e.id
     and coalesce(eu.company_id, v_company_id) = v_company_id
     and coalesce(eu.is_active, true)
    where coalesce(e.company_id, v_company_id) = v_company_id
    order by e.joining_date desc nulls last, e.created_at desc;
  end if;
end;
$$;

revoke all on function public.erp_list_employees() from public;
grant execute on function public.erp_list_employees() to authenticated;
