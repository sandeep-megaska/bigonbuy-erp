-- 0132_fix_exit_finalize_initiated_by.sql
-- Ensure initiated_by_user_id is populated for exit inserts

create or replace function public.erp_hr_employee_exit_finalize(
  p_employee_id uuid,
  p_last_working_day date,
  p_exit_type_id uuid,
  p_exit_reason_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exit_id uuid;
  v_company_id uuid := public.erp_current_company_id();
  v_user_id uuid := auth.uid();
begin
  perform public.erp_require_hr_writer();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    last_working_day,
    exit_type_id,
    exit_reason_id,
    notes,
    status,
    initiated_by_user_id
  )
  values (
    v_company_id,
    p_employee_id,
    p_last_working_day,
    p_exit_type_id,
    p_exit_reason_id,
    p_notes,
    'completed',
    v_user_id
  )
  returning id into v_exit_id;

  update public.erp_employees
  set lifecycle_status = 'exited',
      exit_date = p_last_working_day
  where id = p_employee_id;

  return v_exit_id;
end;
$$;
