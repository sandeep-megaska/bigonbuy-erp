-- Employee activation gating

create or replace function public.erp_hr_employee_activate(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee record;
  v_has_contact boolean;
  v_has_address boolean;
  v_has_salary boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized';
  end if;

  select *
    into v_employee
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if v_employee.id is null then
    raise exception 'Employee not found';
  end if;

  if v_employee.full_name is null or btrim(v_employee.full_name) = '' then
    raise exception 'Employee full name is required';
  end if;

  if v_employee.joining_date is null then
    raise exception 'Employee joining date is required';
  end if;

  v_has_contact := exists (
    select 1
    from public.erp_employee_contacts c
    where c.company_id = v_company_id
      and c.employee_id = p_employee_id
      and (c.email is not null or c.phone is not null)
  );

  if not v_has_contact then
    raise exception 'Employee contact (phone or email) is required';
  end if;

  v_has_address := exists (
    select 1
    from public.erp_employee_addresses a
    where a.company_id = v_company_id
      and a.employee_id = p_employee_id
      and a.country is not null
      and a.state is not null
      and a.city is not null
  );

  if not v_has_address then
    raise exception 'Employee address (country, state, city) is required';
  end if;

  v_has_salary := exists (
    select 1
    from public.erp_salary_structures s
    where s.company_id = v_company_id
      and s.employee_id = p_employee_id
      and s.effective_from <= current_date
      and (s.effective_to is null or s.effective_to >= current_date)
  );

  if not v_has_salary then
    raise exception 'Active salary structure is required';
  end if;

  update public.erp_employees
     set lifecycle_status = 'active'
   where company_id = v_company_id
     and id = p_employee_id;
end;
$$;

revoke all on function public.erp_hr_employee_activate(uuid) from public;
grant execute on function public.erp_hr_employee_activate(uuid) to authenticated;

notify pgrst, 'reload schema';
