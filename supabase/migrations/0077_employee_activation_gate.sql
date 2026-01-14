-- Employee activation gate RPC

create or replace function public.erp_hr_employee_activate(
  p_employee_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee jsonb;
  v_joining_date text;
  v_salary_json jsonb;
  v_missing text[] := '{}';
  v_has_contact boolean := false;
  v_has_address boolean := false;
  v_has_salary boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) then
    raise exception 'Not authorized';
  end if;

  select to_jsonb(e)
    into v_employee
  from public.erp_employees e
  where e.id = p_employee_id
    and e.company_id = v_company_id;

  if v_employee is null then
    raise exception 'Employee not found';
  end if;

  if nullif(trim(coalesce(v_employee->>'full_name', '')), '') is null then
    v_missing := v_missing || 'full name';
  end if;

  v_joining_date := nullif(trim(coalesce(v_employee->>'joining_date', '')), '');
  if v_joining_date is null then
    v_joining_date := nullif(trim(coalesce(v_employee->>'date_of_joining', '')), '');
  end if;
  if v_joining_date is null then
    v_missing := v_missing || 'joining date';
  end if;

  select exists (
    select 1
    from public.erp_employee_contacts c
    where c.employee_id = p_employee_id
      and c.company_id = v_company_id
      and (nullif(trim(coalesce(c.phone, '')), '') is not null
        or nullif(trim(coalesce(c.email, '')), '') is not null)
  ) into v_has_contact;

  if not v_has_contact then
    v_missing := v_missing || 'contact (phone or email)';
  end if;

  select exists (
    select 1
    from public.erp_employee_addresses a
    where a.employee_id = p_employee_id
      and a.company_id = v_company_id
      and nullif(trim(coalesce(a.city, '')), '') is not null
      and nullif(trim(coalesce(a.state, '')), '') is not null
      and nullif(trim(coalesce(a.country, '')), '') is not null
  ) into v_has_address;

  if not v_has_address then
    v_missing := v_missing || 'address (city/state/country)';
  end if;

  select exists (
    select 1
    from public.erp_employee_compensations c
    where c.employee_id = p_employee_id
      and c.company_id = v_company_id
      and c.effective_from <= current_date
      and (c.effective_to is null or c.effective_to >= current_date)
  ) into v_has_salary;

  v_salary_json := v_employee->'salary_json';
  if not v_has_salary and v_salary_json is not null then
    if nullif(trim(coalesce(v_salary_json->>'salary_basic', '')), '') is not null
      or nullif(trim(coalesce(v_salary_json->>'salary_hra', '')), '') is not null
      or nullif(trim(coalesce(v_salary_json->>'salary_allowances', '')), '') is not null
      or nullif(trim(coalesce(v_salary_json->>'basic', '')), '') is not null
      or nullif(trim(coalesce(v_salary_json->>'hra', '')), '') is not null
      or nullif(trim(coalesce(v_salary_json->>'allowances', '')), '') is not null
    then
      v_has_salary := true;
    end if;
  end if;

  if not v_has_salary then
    v_missing := v_missing || 'salary';
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'Activation blocked. Missing: %', array_to_string(v_missing, ', ');
  end if;

  update public.erp_employees
     set lifecycle_status = 'active'
   where id = p_employee_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_hr_employee_activate(uuid) from public;
grant execute on function public.erp_hr_employee_activate(uuid) to authenticated;

notify pgrst, 'reload schema';
