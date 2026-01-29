-- Create RPC to ensure an exit record exists for an employee

create or replace function public.erp_hr_employee_exit_ensure(
  p_employee_id uuid,
  p_last_working_day date default null,
  p_reason_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_exit_id uuid;
  v_exit_type_id uuid;
  v_manager_employee_id uuid;
  v_last_working_day date;
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

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Invalid employee_id';
  end if;

  select e.id
    into v_exit_id
  from public.erp_hr_employee_exits e
  where e.company_id = v_company_id
    and e.employee_id = p_employee_id
    and e.status in ('draft', 'submitted', 'approved')
  order by e.created_at desc
  limit 1;

  if v_exit_id is not null then
    return v_exit_id;
  end if;

  select e.id
    into v_exit_id
  from public.erp_hr_employee_exits e
  where e.company_id = v_company_id
    and e.employee_id = p_employee_id
    and e.status in ('finalized', 'completed')
  order by e.created_at desc
  limit 1;

  if v_exit_id is not null then
    return v_exit_id;
  end if;

  if p_reason_id is not null then
    if not exists (
      select 1
      from public.erp_hr_employee_exit_reasons r
      where r.id = p_reason_id
        and r.company_id = v_company_id
        and r.is_active
    ) then
      raise exception 'Invalid reason_id';
    end if;
  end if;

  select t.id
    into v_exit_type_id
  from public.erp_hr_employee_exit_types t
  where t.company_id = v_company_id
    and t.is_active
  order by t.sort_order asc, t.name asc
  limit 1;

  if v_exit_type_id is null then
    raise exception 'No active exit type configured';
  end if;

  select j.manager_employee_id
    into v_manager_employee_id
  from public.erp_employee_jobs j
  where j.company_id = v_company_id
    and j.employee_id = p_employee_id
  order by j.effective_from desc, j.created_at desc
  limit 1;

  v_last_working_day := coalesce(p_last_working_day, current_date);

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    exit_type_id,
    exit_reason_id,
    initiated_by_user_id,
    status,
    initiated_on,
    last_working_day,
    notice_waived,
    manager_employee_id,
    notes
  ) values (
    v_company_id,
    p_employee_id,
    v_exit_type_id,
    p_reason_id,
    v_actor,
    'draft',
    current_date,
    v_last_working_day,
    false,
    v_manager_employee_id,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_exit_id;

  return v_exit_id;
end;
$$;

revoke all on function public.erp_hr_employee_exit_ensure(uuid, date, uuid, text) from public;

grant execute on function public.erp_hr_employee_exit_ensure(uuid, date, uuid, text) to authenticated;
