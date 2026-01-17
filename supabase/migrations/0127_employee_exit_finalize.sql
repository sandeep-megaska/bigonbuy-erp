begin;

create or replace function public.erp_hr_employee_exit_finalize(
  p_employee_id uuid,
  p_exit_type_id uuid,
  p_exit_reason_id uuid,
  p_last_working_day date,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_exit_id uuid;
  v_lifecycle_status text;
begin
  perform public.erp_require_hr_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_exit_type_id is null then
    raise exception 'exit_type_id is required';
  end if;

  if p_exit_reason_id is null then
    raise exception 'exit_reason_id is required';
  end if;

  if p_last_working_day is null then
    raise exception 'last_working_day is required';
  end if;

  select e.lifecycle_status
    into v_lifecycle_status
  from public.erp_employees e
  where e.id = p_employee_id
    and e.company_id = v_company_id;

  if v_lifecycle_status is null then
    raise exception 'Invalid employee_id';
  end if;

  if v_lifecycle_status = 'inactive' then
    raise exception 'Employee is already inactive';
  end if;

  if exists (
    select 1
    from public.erp_hr_employee_exits e
    where e.company_id = v_company_id
      and e.employee_id = p_employee_id
      and e.status = 'completed'
  ) then
    raise exception 'An exit has already been completed for this employee.';
  end if;

  if not exists (
    select 1
    from public.erp_hr_employee_exit_types t
    where t.id = p_exit_type_id
      and t.company_id = v_company_id
      and t.is_active
  ) then
    raise exception 'Invalid exit_type_id';
  end if;

  if not exists (
    select 1
    from public.erp_hr_employee_exit_reasons r
    where r.id = p_exit_reason_id
      and r.company_id = v_company_id
      and r.is_active
  ) then
    raise exception 'Invalid exit_reason_id';
  end if;

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    exit_type_id,
    exit_reason_id,
    initiated_by_user_id,
    status,
    initiated_on,
    last_working_day,
    completed_by_user_id,
    completed_at,
    notes
  ) values (
    v_company_id,
    p_employee_id,
    p_exit_type_id,
    p_exit_reason_id,
    v_actor,
    'completed',
    current_date,
    p_last_working_day,
    v_actor,
    now(),
    p_notes
  )
  returning id into v_exit_id;

  update public.erp_employees
     set lifecycle_status = 'inactive',
         exit_date = p_last_working_day
   where id = p_employee_id
     and company_id = v_company_id;

  return v_exit_id;
end;
$$;

revoke all on function public.erp_hr_employee_exit_finalize(
  uuid,
  uuid,
  uuid,
  date,
  text
) from public;

grant execute on function public.erp_hr_employee_exit_finalize(
  uuid,
  uuid,
  uuid,
  date,
  text
) to authenticated;

commit;
